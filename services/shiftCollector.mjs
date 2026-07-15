/*
シフトを集計してGoogleスプレッドシートに反映する。
*/

import { writeShiftUsers } from "./googleSheet.mjs";

// 定数
// ----------------------------
const SYMBOL_SUPPORT = "🟢";
const SYMBOL_ENCORE = "🟣";
const SYMBOL_NG = "❌";
const MAX_COLUMNS = 4;

// 飛び枠に塗る色
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
// ----------------------------


// シフト集計
export async function collectShift(client, def) {
  console.log(`スプレッドシート更新開始 ${def.sheetName}`);

  const channel = await client.channels.fetch(def.channelId);
  if (!channel?.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 100 });
  const dataByTime = {};

  for (const msg of messages.values()) {
    const time = msg.content.trim();
    if (!/^\d+-\d+$/.test(time)) continue;

    const support = msg.reactions.cache.get(SYMBOL_SUPPORT);
    if (!support) continue;

    const supportUsers = await support.users.fetch();
    const encore = msg.reactions.cache.get(SYMBOL_ENCORE);
    const encoreUsers = encore ? await encore.users.fetch() : new Map();

    const ng = msg.reactions.cache.get(SYMBOL_NG);
    const ngUsers = ng ? await ng.users.fetch() : new Map();
    const hasNG = ngUsers.has(process.env.USER_ADMIN_ID);

    let users = [];
    if(!hasNG){
      users = await Promise.all(
        supportUsers.filter(u => !u.bot).map(async u => {
          let name = u.username;
          try {
            const members = await channel.guild.members.fetch(u.id);
            name = members.displayName;
          } catch {}
          return {
            name,
            isEncore: encoreUsers.has(u.id),
          };
        })
      );
    }

    dataByTime[time] = {
      users,
      hasNG,
    };
  }

  // 時刻順に並び変える
  const times = Object.keys(dataByTime).sort((a, b) => {
    const [ah] = a.split("-").map(Number);
    const [bh] = b.split("-").map(Number);
    return ah - bh;
  });

  // ユーザーを、提出時刻の多い順に並び変える (シフト表での列を決めるのに使用)
  const freq = {};
  Object.values(dataByTime).forEach(entry =>
    entry.users.forEach(u => {
      freq[u.name] = (freq[u.name] || 0) + 1;
    })
  );
  const sortedUsers = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([name]) => name);

  // ユーザーが、それぞれどの列に入るのかを定義する
  // ・デフォルトで入る列 (各ユーザーごとに1列ずつ)
  const timeAssignments = {};
  times.forEach(t => (timeAssignments[t] = {}));
  const userToCol = {};
  for (const user of sortedUsers) {
    const appearTimes = times.filter(t =>
      dataByTime[t].users.some(u => u.name === user)
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
  // ・各時間帯ごとに入る列
  const placements = {};
  for (const t of times) {
    const used = new Set();
    placements[t] = [];

    for (const u of dataByTime[t].users) {
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

  //ユーザーに着目して情報を整理
  const userHistory = {};
  times.forEach((timeLabel, rowIndex) => {
    const startHour = Number(timeLabel.split("-")[0]);

    for (const u of placements[timeLabel]) {
      if (!userHistory[u.name]) {
        userHistory[u.name] = {
          cols: new Set(),
          hours: [],
        };
      }

      userHistory[u.name].cols.add(u.col);
      userHistory[u.name].hours.push(startHour);
    }
  });

  // 飛び枠の着色を必要とするユーザーをまとめる
  const needBgUser = {};
  for (const [name, info] of Object.entries(userHistory)) {

    // 複数列に跨るか
    const multiCol = info.cols.size >= 2;

    // 時間帯の飛びがあるか
    const hours = info.hours.sort((a, b) => a - b);
    const skipped = hours.some(
      (h, i) => i > 0 && hours[i - 1] + 1 !== h
    );

    needBgUser[name] = multiCol || skipped;
  }
  // 着色が必要なら、色をここでユーザーごとに定義しておく
  const bgUsers = Object.keys(needBgUser).filter(u => needBgUser[u]);
  const userToColor = {};
  bgUsers.forEach((name, i) => {
    userToColor[name] = USER_COLOR_PALETTE[i % USER_COLOR_PALETTE.length];
  });

  // Googleスプレッドシートに反映
  const rows = times.map(t => {
    const users = placements[t].map(u => ({
      ...u,
      needBg: needBgUser[u.name],
      bgColor: userToColor[u.name] || null,
    }));

    // オーバーフロー判定: 列数超過または割当できなかったユーザーがいる場合
    const overflow = users.length > MAX_COLUMNS || users.some(u => u.col === undefined);

    return {
      timeLabel: t,
      hasNG: dataByTime[t].hasNG,
      overflow,
      users,
    };
  });

  await writeShiftUsers({ sheetName: def.sheetName, rows });
}
