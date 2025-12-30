// services/shiftCollector.mjs
import { writeShiftUsers } from "./googleSheet.mjs";

const MAIN_EMOJI = "✅";
const STAR_EMOJI = "💫";
const MAX_COLUMNS = 4;

// ★ 最大10色（ユーザー単位）
const USER_COLOR_PALETTE = [
  { red: 0.90, green: 0.95, blue: 1.00 },
  { red: 0.90, green: 1.00, blue: 0.90 },
  { red: 1.00, green: 0.95, blue: 0.90 },
  { red: 0.90, green: 1.00, blue: 1.00 },
  { red: 0.95, green: 0.90, blue: 1.00 },
  { red: 0.95, green: 1.00, blue: 0.90 },
  { red: 1.00, green: 0.90, blue: 0.90 },
  { red: 0.95, green: 0.95, blue: 0.90 },
  { red: 0.90, green: 0.90, blue: 1.00 },
  { red: 1.00, green: 0.95, blue: 0.95 },
];

export async function collectShift(client, def) {
  console.log(`スプレッドシート更新開始 ${def.sheetName}`);

  const channel = await client.channels.fetch(def.channelId);
  if (!channel?.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 50 });

  /** time -> [{ name, isStar }] */
  const dataByTime = {};

  for (const msg of messages.values()) {
    const time = msg.content.trim();
    if (!/^\d+-\d+$/.test(time)) continue;

    const main = msg.reactions.cache.get(MAIN_EMOJI);
    if (!main) continue;

    const mainUsers = await main.users.fetch();
    const star = msg.reactions.cache.get(STAR_EMOJI);
    const starUsers = star ? await star.users.fetch() : new Map();

    const users = await Promise.all(
      mainUsers.filter(u => !u.bot).map(async u => {
        let name = u.username;
        try {
          const m = await channel.guild.members.fetch(u.id);
          name = m.displayName;
        } catch {}
        return {
          name,
          isStar: starUsers.has(u.id),
        };
      })
    );

    dataByTime[time] = users;
  }

  // ===== 以下、既存ロジック完全そのまま =====
  const times = Object.keys(dataByTime).sort((a, b) => {
    const [ah] = a.split("-").map(Number);
    const [bh] = b.split("-").map(Number);
    return ah - bh;
  });

  const freq = {};
  Object.values(dataByTime).forEach(users =>
    users.forEach(u => {
      freq[u.name] = (freq[u.name] || 0) + 1;
    })
  );

  const sortedUsers = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const timeAssignments = {};
  times.forEach(t => (timeAssignments[t] = {}));

  const userToCol = {};

  for (const user of sortedUsers) {
    const appearTimes = times.filter(t =>
      dataByTime[t].some(u => u.name === user)
    );

    for (let col = 0; col < MAX_COLUMNS; col++) {
      const ok = appearTimes.every(
        t => !Object.values(timeAssignments[t]).includes(col)
      );
      if (ok) {
        userToCol[user] = col;
        appearTimes.forEach(t => (timeAssignments[t][user] = col));
        break;
      }
    }
  }

  const placements = {};
  for (const t of times) {
    const used = new Set();
    placements[t] = [];

    for (const u of dataByTime[t]) {
      let col = userToCol[u.name];
      if (col === undefined || used.has(col)) {
        for (let c = 0; c < MAX_COLUMNS; c++) {
          if (!used.has(c)) {
            col = c;
            break;
          }
        }
      }
      used.add(col);
      placements[t].push({ ...u, col });
    }
  }

  const userHistory = {};
  times.forEach((_, rowIndex) => {
    for (const u of placements[times[rowIndex]]) {
      if (!userHistory[u.name]) {
        userHistory[u.name] = { cols: new Set(), rows: [] };
      }
      userHistory[u.name].cols.add(u.col);
      userHistory[u.name].rows.push(rowIndex);
    }
  });

  const needBgUser = {};
  for (const [name, info] of Object.entries(userHistory)) {
    const multiCol = info.cols.size >= 2;
    const rows = info.rows.sort((a, b) => a - b);
    const skipped = rows.some((r, i) => i > 0 && rows[i - 1] + 1 !== r);
    needBgUser[name] = multiCol || skipped;
  }

  const bgUsers = Object.keys(needBgUser).filter(u => needBgUser[u]);
  const userToColor = {};
  bgUsers.forEach((name, i) => {
    userToColor[name] = USER_COLOR_PALETTE[i % USER_COLOR_PALETTE.length];
  });

  for (const t of times) {
    await writeShiftUsers({
      sheetName: def.sheetName,
      timeLabel: t,
      users: placements[t].map(u => ({
        ...u,
        needBg: needBgUser[u.name],
        bgColor: userToColor[u.name] || null,
      })),
    });
  }
}
