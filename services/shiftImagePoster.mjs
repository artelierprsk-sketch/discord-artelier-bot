/*
シフト表を画像化してメッセージとして送信する。
*/

import { createCanvas, registerFont } from "canvas";
import { AttachmentBuilder } from "discord.js";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

// __dirname (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// フォント
registerFont(
  path.join(__dirname, "../fonts/NotoSansCJKjp-Regular.otf"),
  { family: "NotoSansCJKjp" }
);
const FONT_FAMILY = '"NotoSansCJKjp","Segoe UI Emoji","Segoe UI Symbol","Meiryo","Arial",sans-serif';

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

function colorToCss(color, fallback) {
  if (!color) return fallback;
  const r = Math.round((color.red ?? 0) * 255);
  const g = Math.round((color.green ?? 0) * 255);
  const b = Math.round((color.blue ?? 0) * 255);
  const a = color.alpha ?? 1;
  return `rgba(${r},${g},${b},${a})`;
}

function drawTextInCell(ctx, text, x, y, cellW, cellH) {
  const PADDING = 8;
  const MAX_FONT = 16;
  const MIN_FONT = 10;
  const LINE_HEIGHT_RATIO = 1.2;

  let fontSize = MAX_FONT;
  let lines = [];

  // フォントサイズを下げながら試行
  while (fontSize >= MIN_FONT) {
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;

    lines = wrapText(ctx, text, cellW - PADDING * 2);

    const lineHeight = fontSize * LINE_HEIGHT_RATIO;
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= (cellH - PADDING * 2)) {
      break;
    }

    fontSize--;
  }

  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const startY =
    y + (cellH - lines.length * lineHeight) / 2 + lineHeight / 2;

  // 他セルにはみ出さないようクリップ
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, cellW, cellH);
  ctx.clip();

  lines.forEach((line, i) => {
    const drawY = startY + i * lineHeight;
    if (drawY > y + cellH) return;
    ctx.fillText(line, x + cellW / 2, drawY);
  });

  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const chars = String(text).split("");
  const lines = [];
  let current = "";

  for (const ch of chars) {
    const test = current + ch;
    const width = ctx.measureText(test).width;

    if (width > maxWidth && current !== "") {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }

  if (current) lines.push(current);

  return lines;
}

export function renderShiftImage(rowData) {
  const CELL_W = 180;
  const CELL_H = 40;
  const MAX_W = 4000;
  const MAX_H = 4000;

  // 最大行数
  let maxRow = 0;
  for (let r = 0; r < rowData.length; r++) {
    const cellA = rowData[r]?.values?.[0];
    if (cellA?.userEnteredValue) {
      maxRow = r + 1;
    }
  }
  if (maxRow === 0) return null;

  // 最大列数
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
        drawTextInCell(
          ctx,
          String(value),
          x,
          y,
          CELL_W,
          CELL_H
        );
      }
    }
  }

  return canvas.toBuffer("image/png");
}

// 更新メッセージ生成
function buildMessageText(def) {
  const now = new Date();

  const strMonth = String(now.getMonth() + 1).padStart(2, "0");
  const strDate = String(now.getDate()).padStart(2, "0");
  const strHour = String(now.getHours()).padStart(2, "0");
  const strMinute = String(now.getMinutes()).padStart(2, "0");

  return (`(※自動更新中…  最終更新 : ${strMonth}/${strDate} ${strHour}:${strMinute})`);
}

// Discordに投稿
export async function postShiftImages({client, mode, triggerMessage, shiftDefinitions,}) {
  console.log("postShiftImages start");
  if (!Array.isArray(shiftDefinitions)) {
    throw new Error("shiftDefinitions must be an array");
  }

  for (const def of shiftDefinitions) {
    const rowData = await loadSheetCells(def.sheetName);
    const png = renderShiftImage(rowData);
    if (!png) continue;

    const date = new Date(def.date);
    const weeks = ["日", "月", "火", "水", "木", "金", "土"];
    const strMonth = date.getMonth() + 1;
    const strDate = date.getDate();
    const week = weeks[date.getDay()];

    const identifier = `${strMonth}月${strDate}日(${week})`;// ${def.sheetName}`;
    const content = `${identifier}\n\n${buildMessageText(def)}`;

    const attachment = new AttachmentBuilder(png, {
      name: `${def.sheetName}.png`,
    });

    if ((mode === "message") && triggerMessage) {
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
