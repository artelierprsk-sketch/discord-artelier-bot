import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
  } from "discord.js";
  
  import {
    renderShiftImage,
  } from "../services/shiftImagePoster.mjs";
  
  import { google } from "googleapis";
  import { SHIFT_DEFINITIONS } from "../services/shiftDefinitions.mjs";
  import { AttachmentBuilder } from "discord.js";
  
  /* =========================
     Google Sheets client
  ========================= */
  function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: "service_account",
        project_id: process.env.GOOGLE_PROJECT_ID,
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    return google.sheets({ version: "v4", auth });
  }
  
  /* =========================
     Sheet → Cell 情報取得
  ========================= */
  async function loadSheetCells(sheetName) {
    const sheets = getSheetsClient();
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  
    const res = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      includeGridData: true,
      ranges: [`${sheetName}!A2:F50`],
    });
  
    const sheet = res.data.sheets?.[0];
    return sheet?.data?.[0]?.rowData ?? [];
  }
  
  /* =========================
     Slash Command 定義
  ========================= */
  export const command = new SlashCommandBuilder()
    .setName("shiftimage")
    .setDescription("シフト表の画像を生成して投稿します");
  
  /* =========================
     実行処理
  ========================= */
  export async function execute(interaction) {
    // ボタン作成
    const row = new ActionRowBuilder();
  
    for (const def of SHIFT_DEFINITIONS) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`shiftImage:${def.key}`)
          .setLabel(def.sheetName)
          .setStyle(ButtonStyle.Primary)
      );
    }
  
    await interaction.reply({
      content: "表示したい日付を選択してください。",
      components: [row],
    });
  
    const message = await interaction.fetchReply();
  
    // ボタン待ち受け
    const collector = message.createMessageComponentCollector({
      time: 15 * 60 * 1000, // 15分
    });
  
    collector.on("collect", async i => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({
          content: "この操作はコマンド実行者のみ行えます。",
          ephemeral: true,
        });
        return;
      }
  
      const key = i.customId.replace("shiftImage:", "");
      const def = SHIFT_DEFINITIONS.find(d => d.key === key);
      if (!def) {
        await i.reply({ content: "不明なシフトです。", ephemeral: true });
        return;
      }
  
      await i.deferReply();
  
      // シート読み込み → 画像化
      const rowData = await loadSheetCells(def.sheetName);
      const png = renderShiftImage(rowData);
  
      if (!png) {
        await i.editReply("シフトデータがありません。");
        return;
      }
  
      const date = new Date(def.date);
      const jpWeek = ["日", "月", "火", "水", "木", "金", "土"];
      const m = date.getMonth() + 1;
      const d = date.getDate();
      const w = jpWeek[date.getDay()];
  
      const content = `${m}月${d}日(${w}) ${def.sheetName}`;
  
      const attachment = new AttachmentBuilder(png, {
        name: `${def.sheetName}.png`,
      });
  
      await i.editReply({
        content,
        files: [attachment],
      });
    });
  
    collector.on("end", async () => {
      // ボタン無効化
      const disabledRow = new ActionRowBuilder().addComponents(
        row.components.map(btn => ButtonBuilder.from(btn).setDisabled(true))
      );
  
      await message.edit({
        components: [disabledRow],
      });
    });
  }
  