// services/googleSheet.mjs
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

// ★ 列数上限
const MAX_COLUMNS = 4;

export async function writeShiftUsers({ sheetName, timeLabel, users }) {
  const sheets = getSheetsClient();
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;

  // === sheetId 取得 ===
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) return;

  const sheetId = sheet.properties.sheetId;

  // === 行番号取得 ===
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:A`,
  });

  const row = (res.data.values || []).findIndex(r => r[0] === timeLabel);
  if (row === -1) return;

  const requests = [];

  // === ① まず行全体を初期化 ===
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: row,
        endRowIndex: row + 1,
        startColumnIndex: 2, // C列
        endColumnIndex: 6,   // F列
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: null,
          textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } },
        },
      },
      fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor",
    },
  });

  // === ② 通常のユーザー名更新 ===
  const values = [["", "", "", ""]];
  users.forEach(u => {
    values[0][u.col] = u.name;
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!C${row + 1}:F${row + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  // === ③ ユーザー個別の色設定 ===
  for (const u of users) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: row,
          endRowIndex: row + 1,
          startColumnIndex: 2 + u.col,
          endColumnIndex: 3 + u.col,
        },
        cell: {
          userEnteredFormat: {
            ...(u.needBg && u.bgColor ? { backgroundColor: u.bgColor } : {}),
            textFormat: {
              foregroundColor: u.isStar
                ? { red: 1, green: 0, blue: 0 }
                : { red: 0, green: 0, blue: 0 },
            },
          },
        },
        fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor",
      },
    });
  }

  // === ④ 列数を超える場合の例外処理 ===
  if (users.length > MAX_COLUMNS) {
    // 空欄にする
    const redValues = [["", "", "", ""]];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!C${row + 1}:F${row + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: redValues },
    });

    // 背景を真っ赤に
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: row,
          endRowIndex: row + 1,
          startColumnIndex: 2,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1, green: 0, blue: 0 },
          },
        },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  }

  // === ⑤ 反映 ===
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests },
    });
  }

  console.log(`✅ ${sheetName} ${timeLabel} 更新完了`);
}
