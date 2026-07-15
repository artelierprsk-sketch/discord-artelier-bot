import { SlashCommandBuilder } from "discord.js";
import { google } from "googleapis";

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: "service_account",
      project_id: process.env.GOOGLE_PROJECT_ID,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function appendToRefreshSheet(refreshGauge, restHours, now) {
  const sheets = getSheetsClient();
  const SHEET_ID = process.env.GOOGLE_REFRESH_SHEET_ID;
  const SHEET_NAME = "記録";

  // A列を読み取って最初の空行を見つける
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`,
  });

  const values = res.data.values || [];
  let rowIndex = values.length; // 0-based index

  // 最初の空行を見つける
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0] || values[i][0].trim() === "") {
      rowIndex = i;
      break;
    }
  }

  // 日時をフォーマット (JST)
  const jstOffset = 9 * 60 * 60 * 1000; // JST is UTC+9
  const jstNow = new Date(now.getTime() + jstOffset);
  const dateStr = jstNow.toISOString().slice(0, 19).replace("T", " ");

  // 書き込むデータ
  const rowData = [
    dateStr,
    refreshGauge.toFixed(1),
  ];

  if (restHours > 0) {
    rowData.push(restHours.toFixed(1));
  }

  // 書き込み
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${rowIndex + 1}:C${rowIndex + 1}`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [rowData],
    },
  });
}

export const command = new SlashCommandBuilder()
  .setName("refresh")
  .setDescription("リフレッシュゲージと休憩時間を入力します")
  .addNumberOption((option) =>
    option
      .setName("refresh_gauge")
      .setDescription("リフレッシュゲージ量 (小数点第1位まで)")
      .setRequired(true)
      .setMaxValue(100)
      .setMinValue(0)
  )
  .addNumberOption((option) =>
    option
      .setName("rest_hours")
      .setDescription("休憩時間 (h、未入力の場合は0)")
      .addChoices(
        { name: "0", value: 0.0 },
        { name: "0.5", value: 0.5 },
        { name: "1", value: 1.0 },
        { name: "1.5", value: 1.5 },
        { name: "2", value: 2.0 },
        { name: "2.5", value: 2.5 },
        { name: "3", value: 3.0 },
        { name: "3.5", value: 3.5 },
        { name: "4", value: 4.0 },
        { name: "4.5", value: 4.5 },
        { name: "5", value: 5.0 },
        { name: "5.5", value: 5.5 },
        { name: "6", value: 6.0 }
      )
  );

export async function execute(interaction) {
  // 実行権限チェック: 環境変数 USER_ADMIN_ID のユーザーのみ許可
  try {
    const adminId = String(process.env.USER_ADMIN_ID || "");
    if (interaction.user?.id !== adminId) {
      await interaction.reply({ content: "❌ このコマンドは管理者のみ実行できます。", ephemeral: true });
      return;
    }
  } catch (err) {
    console.error("❌ admin check error:", err);
    await interaction.reply({ content: "❌ 実行権限の確認中にエラーが発生しました。", ephemeral: true });
    return;
  }
  const refreshGauge = interaction.options.getNumber("refresh_gauge");
  let restHours = interaction.options.getNumber("rest_hours");

  if (refreshGauge === null) {
    await interaction.reply({ content: "❌ リフレッシュゲージの入力が必要です。", ephemeral: true });
    return;
  }

  const isOneDecimalPlace = Number.isInteger(refreshGauge * 10);
  if (!isOneDecimalPlace) {
    await interaction.reply({
      content: "❌ リフレッシュゲージは小数点第1位までの実数値で入力してください。",
      ephemeral: true,
    });
    return;
  }

  if (restHours === null) {
    restHours = 0.0;
  }

  // now を取得
  const now = new Date();

  try {
    await appendToRefreshSheet(refreshGauge, restHours, now);
  } catch (error) {
    console.error("❌ Google Sheets 書き込みエラー:", error);
    await interaction.reply({
      content: "❌ データの保存に失敗しました。もう一度お試しください。",
      ephemeral: true,
    });
    return;
  }

  // CHANNEL_REFRESH_ID に refreshGauge を投稿
  try {
    const channel = interaction.client.channels.cache.get(process.env.CHANNEL_REFRESH_ID);
    if (channel) {
      let message = `${refreshGauge}`;
      if (restHours > 0) {
        message += ` (休憩 ${restHours}h)`;

        const date = new Date(now.getTime() + restHours * 3600000 + 9 * 60 * 60 * 1000);
        const restartTime = `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

        message += ` → ${restartTime}再開`;
      }

      await channel.send(`${message}`); //.toFixed(1)}`);
    }
  } catch (error) {
    console.error("❌ チャンネル投稿エラー:", error);
  }

  // 休憩時間終了の通知
  if (restHours > 0) {
    const restMs = restHours * 3600000;
    const endTime = now.getTime() + restMs;

    const notify = async (message) => {
      try {
        await interaction.channel.send(`<@${process.env.USER_ADMIN_ID}> ${message}`);
      } catch (error) {
        console.error("❌ タイマー通知エラー:", error);
      }
    };

    let delayMinA = 5;
    let delayA = endTime - delayMinA * 60 * 1000 - Date.now();
    if (delayA > 0) {
      setTimeout(() => notify(`休憩時間終了まであと${delayMinA}分です。`), delayA);
    }

    const delayMinB = 2;
    const delayB = endTime - delayMinB * 60 * 1000 - Date.now();
    if (delayB > 0) {
      setTimeout(() => notify(`休憩時間終了まであと${delayMinB}分です。`), delayB);
    }

    const delay = endTime - 15 * 1000 - Date.now();
    if (delay > 0) {
      setTimeout(() => notify("休憩時間がまもなく終了します。"), delay);
    }
  }

  // 返信
  let content = `リフレッシュゲージ: 【${refreshGauge}】`;
  content += restHours > 0 ? `\n休憩時間: 【${restHours}】h` : "";
  content += `\n\n入力を受け付けました。`;

  // ゲージ100%になる時刻の予測
  if (restHours === 0) {
    const PLAY_MAX_PER_HOUR = Number(process.env.REFRESH_PLAY_MAX_PER_HOUR);
    const PLAY_MIN_PER_HOUR = Number(process.env.REFRESH_PLAY_MIN_PER_HOUR);
    const GAUGE_MAX = Number(process.env.REFRESH_GAUGE_MAX);
    const GAUGE_ENVY = Number(process.env.REFRESH_GAUGE_ENVY);
    
    const remainingGauge = GAUGE_MAX * (1 - (refreshGauge / 100)); // 残りのリフレッシュゲージ量
    const remainingPlayCount = Math.floor(remainingGauge / GAUGE_ENVY); // 残りの周回数
    const earliestPlaySeconds = (remainingPlayCount / PLAY_MAX_PER_HOUR) * 3600; // 最速で周回した場合の秒数
    const latestPlaySeconds = (remainingPlayCount / PLAY_MIN_PER_HOUR) * 3600; // 最遅で周回した場合の秒数
    console.log(remainingGauge , remainingPlayCount , earliestPlaySeconds, latestPlaySeconds);
    
    const earliestPlayAt = new Date(now.getTime() + earliestPlaySeconds * 1000);
    const latestPlayAt = new Date(now.getTime() + latestPlaySeconds * 1000);
    
    const formatJST = (date) => {
      const jstOffset = 9 * 60 * 60 * 1000;
      const jstDate = new Date(date.getTime() + jstOffset);
      const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(jstDate.getUTCDate()).padStart(2, '0');
      const hours = String(jstDate.getUTCHours()).padStart(2, '0');
      const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
      return `${month}/${day} ${hours}:${minutes}`;
    };
  
    content += `\n\n➡️ 100%までおよそ ${(earliestPlaySeconds/3600).toFixed(1)}時間`
    content += ` (${formatJST(earliestPlayAt)} ～ ${formatJST(latestPlayAt)})`;
  };


  // const content = restHours === 0
    // ? `リフレッシュゲージ: ${refreshGauge}\n\n入力を受け付けました。`
    // : `リフレッシュゲージ: ${refreshGauge}\n休憩時間: ${restHours}h\n\n入力を受け付けました。`;
  await interaction.reply({ content });
}
