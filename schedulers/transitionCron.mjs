/*
今の時間帯と次の時間帯のシフトを確認し、交代状況のメッセージを送信する
*/

import cron from "node-cron";
import { SHIFT_DEFINITIONS } from "../services/shiftDefinitions.mjs";

// 定数
// ----------------------------
const STR_CRON = "44 * * * *";
const SUPPORT_EMOJI = "🟢";
const NG_EMOJI = "❌";
// ----------------------------


// 時刻を4-28時制に補正する
function normalizeToShiftTime(now = new Date()) {
  const date = new Date(now);

  let year = date.getFullYear();
  let month = date.getMonth();
  let day = date.getDate();
  let hour = date.getHours();
  let minute = date.getMinutes();

  if (hour < 4) {
    const preDate = new Date(year, month, day - 1);

    year = preDate.getFullYear();
    month = preDate.getMonth();
    day = preDate.getDate();

    hour += 24;
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
  };
}


// 日付表記を整形して返す。
// shiftDefinitions.mjs の"date"の値と対応。
function toDateString(year, month, day) {

  const strMonth = String(month + 1).padStart(2, "0");
  const strDate = String(day).padStart(2, "0");

  return `${year}-${strMonth}-${strDate}`;
}


// 次の時間帯の「時」の値を返す
function getNextHour(hour) {

  if (hour === 27) return 4;

  return hour + 1;
}

// 次の時間帯の「年」「月」「日」の値を返す
function getNextDate(year, month, day, hour) {

  if (hour !== 27)
    return { year, month, day };

  const next = new Date(year, month, day + 1);

  return {
    year: next.getFullYear(),
    month: next.getMonth(),
    day: next.getDate(),
  };
}


//指定の時間帯のユーザー一覧を取得する
async function getUsersAtHour(client, channelId, hour) {

  const channel =
    await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) return null;

  const messages = await channel.messages.fetch({ limit: 100 });

  const label = `${hour}-${hour + 1}`;
  const msg =
    messages.find(m =>
      m.author.id === client.user.id &&
      m.content.includes(label)
    );
  if (!msg) return null;

  // 休憩時間
  const ng = msg.reactions.cache.get(NG_EMOJI);
  const ngUsers = ng ? await ng.users.fetch() : new Map();
  const hasNG = ngUsers.has(process.env.USER_ADMIN_ID);
  if (hasNG) return null;

  const reaction = msg.reactions.cache.get(SUPPORT_EMOJI);
  if (!reaction) return [];

  const users = await reaction.users.fetch();

  return users
    .filter(u => !u.bot)
    .map(u => `<@${u.id}>`);

  //ユーザー名
  // const result = [];
  // for (const user of users.values()) {
  //   if (user.bot) continue;
  //   try {
  //     const member = await channel.guild.members.fetch(user.id);
  //     result.push(member.displayName);
  //   }
  //   catch {
  //     result.push(user.username);
  //   }
  // }
  //   return result;
}


//メッセージの文字列を生成
function buildReport(strDate, currentHour, nextHour, currentUsers, nextUsers) {
  const spacer = "\u200B";  //ゼロ幅スペース。これがないと見出しと見出しの間が改行されない。

  const current = new Set(currentUsers);
  const next = new Set(nextUsers);

  const end = currentUsers.filter(u => !next.has(u));
  const start = nextUsers.filter(u => !current.has(u));
  const cont = nextUsers.filter(u => current.has(u));

  function format(list) {
    return list.length ? list.join(" ") : "-";
  }

  return `${strDate} ${nextHour}時の交代のアナウンスです。
  
  ## 🔴終了
  ## ${format(end)}
  ## 🟢開始
  ## ${format(start)}
  ## 継続参加
  ## ${format(cont)}`;
}


//メッセージ送信 (cronによる定時実行)
export function startTransitionCron(client) {
  cron.schedule(STR_CRON, async () => {
    const REPORT_CHANNEL_ID = process.env.CHANNEL_KIKISEN_ID;
      try {
        console.log("⏳ transitionCron start");

        // 現在日時を取得 (4-28に補正済)
        const now = normalizeToShiftTime();

        // 今の時間帯のシフトチャンネルを取得
        const strCurrentDate = toDateString(now.year, now.month, now.day);
        const defCurrentShiftChannel = SHIFT_DEFINITIONS.find( shift => shift.date === strCurrentDate);
        if (!defCurrentShiftChannel) return;

        // 次の時間帯の日時、シフトチャンネルを取得
        const nextHour = getNextHour(now.hour);
        const objNextDate = getNextDate(now.year, now.month, now.day, now.hour);
        const strNextDate = toDateString(objNextDate.year, objNextDate.month, objNextDate.day);
        const defNextShiftChannel = SHIFT_DEFINITIONS.find(shift => shift.date === strNextDate);
        if (!defNextShiftChannel) return;

        //今の時間帯、次の時間帯のシフトにリアクションしたユーザー一覧を取得
        const currentUsers = await getUsersAtHour(client, defCurrentShiftChannel.channelId, now.hour);
        let nextUsers = await getUsersAtHour(client, defNextShiftChannel.channelId, nextHour);
        if (!currentUsers) {
          console.log("⏭ transitionCron skip");
          return;
        }
        if (!nextUsers) nextUsers = [];

        const report = buildReport(`${String(now.month+1).padStart(2,"0")}/${String(now.day).padStart(2,"0")}`, now.hour, nextHour, currentUsers, nextUsers);
        const reportChannel = await client.channels.fetch(REPORT_CHANNEL_ID);
        if (!reportChannel?.isTextBased()) return;

        await reportChannel.send({
          content: report, allowedMentions: {users: []}
        });//(report);
        console.log("✅ transition report sent");

      }
      catch (err) {

        console.error(
          "❌ transitionCron error",
          err
        );
      }
    },
    {
      timezone: "Asia/Tokyo"
    }
  );
}