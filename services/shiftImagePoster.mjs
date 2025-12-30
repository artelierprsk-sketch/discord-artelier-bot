// services/shiftImagePoster.mjs
import { createCanvas, registerFont } from "canvas";
import { AttachmentBuilder } from "discord.js";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

/* =========================
   Font setup
========================= */

// __dirname (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日本語フォント
registerFont(
  path.join(__dirname, "../fonts/NotoSansCJKjp-Regular.otf"),
  { family: "NotoSansCJKjp" }
);

// 絵文字フォント
registerFont(
  path.join(__dirname, "../fonts/NotoColorEmoji.ttf"),
  { family: "NotoColorEmoji" }
);

// フォント優先順
const FONT_FAMILY =
  '"NotoColorEmoji","NotoSansCJKjp","Segoe UI Emoji","Segoe UI Symbol","Meiryo","Arial",sans-serif';

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
   色変換
========================= */
function colorToCss(color, fallback) {
  if (!color) return fallback;
  const r = Math.round((color.red ?? 0) * 255);
  const g = Math.round((color.green ?? 0) * 255);
  const b = Math.round((color.blue ?? 0) * 255);
  const a = color.alpha ?? 1;
  return `rgba(${r},${g},${b},${a})`;
}

/* =========================
   PNG 描画
========================= */
export function renderShiftImage(rowData) {
  const CELL_W = 180;
  const CELL_H = 40;
  const MAX_W = 4000;
  const MAX_H = 4000;

  /* ---- 縦：A列に値がある行まで ---- */
  let maxRow = 0;
  for (let r = 0; r < rowData.length; r++) {
    const cellA = rowData[r]?.values?.[0];
    if (cellA?.userEnteredValue) {
      maxRow = r + 1;
    }
  }
  if (maxRow === 0) return null;

  /* ---- 横：値 or 書式がある最大列 ---- */
  let maxCol = 0;
  for (let r = 0; r < maxRow; r++) {
    rowData[r]?.values?.forEach((cell, c) => {
      if (cell?.userEnteredValue || cell?.userEnteredFormat) {
        maxCol = Math.max(maxCol, c + 1);
      }
    });
  }

  const width = Math.min(maxCol * CELL_W, MAX_W);
  const height = Math.min(maxRow * CELL_H, MAX_H);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `16px ${FONT_FAMILY}`;

  for (let r = 0; r < maxRow; r++) {
    for (let c = 0; c < maxCol; c++) {
      const cell = rowData[r]?.values?.[c];
      const x = c * CELL_W;
      const y = r * CELL_H;

      // 背景
      ctx.fillStyle = colorToCss(
        cell?.userEnteredFormat?.backgroundColor,
        "#ffffff"
      );
      ctx.fillRect(x, y, CELL_W, CELL_H);

      // 枠線
      ctx.strokeStyle = "#cccccc";
      ctx.strokeRect(x, y, CELL_W, CELL_H);

      // 文字色
      ctx.fillStyle = colorToCss(
        cell?.userEnteredFormat?.textFormat?.foregroundColor,
        "#000000"
      );

      const value =
        cell?.userEnteredValue?.stringValue ??
        cell?.userEnteredValue?.numberValue ??
        "";

      if (value !== "") {
        ctx.fillText(
          String(value),
          x + CELL_W / 2,
          y + CELL_H / 2
        );
      }
    }
  }

  return canvas.toBuffer("image/png");
}

/* =========================
   メッセージ文生成
========================= */
function buildMessageText(def) {
  const now = new Date();

  const um = now.getMonth() + 1;
  const ud = now.getDate();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");

  return (
`(※自動更新中…  最終更新 : ${um}/${ud} ${hh}:${mm})`
  );
}

/* =========================
   Discord 投稿
========================= */
export async function postShiftImages({
  client,
  mode,
  triggerMessage,
  shiftDefinitions,
}) {
  console.log("postShiftImages start");
  if (!Array.isArray(shiftDefinitions)) {
    throw new Error("shiftDefinitions must be an array");
  }

  for (const def of shiftDefinitions) {
    const rowData = await loadSheetCells(def.sheetName);
    const png = renderShiftImage(rowData);
    if (!png) continue;

    const date = new Date(def.date);
    const jpWeek = ["日", "月", "火", "水", "木", "金", "土"];
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const w = jpWeek[date.getDay()];

    const identifier = `${m}月${d}日(${w}) ${def.sheetName}`;
    const content = `${identifier}\n\n${buildMessageText(def)}`;

    const attachment = new AttachmentBuilder(png, {
      name: `${def.sheetName}.png`,
    });

    if (mode === "message" && triggerMessage) {
      await triggerMessage.channel.send({
        content,
        files: [attachment],
      });
    }

    if (mode === "cron") {
      const channel = await client.channels.fetch(def.channelId);
      if (!channel?.isTextBased()) continue;

      const messages = await channel.messages.fetch({ limit: 20 });

      const old = messages.find(m =>
        m.author.id === client.user.id &&
        m.content.startsWith(identifier)
      );

      if (old) {
        await old.edit({
          content,
          files: [new AttachmentBuilder(png, { name: `${def.sheetName}.png` })],
        });
      } else {
        await channel.send({
          content,
          files: [new AttachmentBuilder(png, { name: `${def.sheetName}.png` })],
        });
      }

      console.log(`✅ ${def.sheetName} シフト画像投稿完了`);
    }
  }
}
