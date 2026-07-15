/*
Googleスプレッドシートに反映する。
*/

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

// 定数
// ----------------------------
const MAX_COLUMNS = 4;
const NG_ROW_COLOR = { red: 0.85, green: 0.85, blue: 0.85 };
// ----------------------------

export async function writeShiftUsers({ sheetName, rows }) {
  const sheetMetaCache = new Map();
  const timeColumnCache = new Map();

  const sheets = getSheetsClient();
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;

  // sheetId取得（キャッシュ利用）
  let sheetId;
  if (sheetMetaCache.has(sheetName)) {
    sheetId = sheetMetaCache.get(sheetName);
  } else {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: "sheets(properties(sheetId,title))",
    });

    const sheet = meta.data.sheets.find(
      s => s.properties.title === sheetName
    );
    if (!sheet) return;

    sheetId = sheet.properties.sheetId;
    sheetMetaCache.set(sheetName, sheetId);
  }

  // A列取得（キャッシュ利用）
  let timeValues;
  if (timeColumnCache.has(sheetName)) {
    timeValues = timeColumnCache.get(sheetName);
  } else {
    const times = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:A`,
    });

    timeValues = times.data.values || [];
    timeColumnCache.set(sheetName, timeValues);
  }

  const requests = [];
  const valueUpdates = [];

  for (const rowData of rows) {
    const row = timeValues.findIndex(r => r[0] === rowData.timeLabel);
    if (row === -1) continue;

    // 名前（オーバーフロー時は空欄扱い）
    const names = [["", "", "", ""]];
    if (!rowData.hasNG && !rowData.overflow) {
      rowData.users.forEach(u => {
        if (typeof u.col === "number" && u.col >= 0 && u.col < MAX_COLUMNS) {
          names[0][u.col] = u.name;
        }
      });
    }

    // 値更新: 通常は names を、オーバーフロー時は空欄にする
    valueUpdates.push({
      range: `${sheetName}!C${row + 1}:F${row + 1}`,
      values: names,
    });

    // オーバーフロー時: 行を赤く塗る（C-F）
    if (rowData.overflow) {
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
      continue;
    }

    // NG行の場合はグレーで塗る（C-F）
    if (rowData.hasNG) {
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
              backgroundColor: NG_ROW_COLOR,
              textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } },
            },
          },
          fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor",
        },
      });
      continue;
    }

    // 色: 通常時は各ユーザーセルの着色／文字色を設定
    for (const u of rowData.users) {
      if (typeof u.col !== "number" || u.col < 0 || u.col >= MAX_COLUMNS) continue;
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
                foregroundColor: u.isEncore ? { red: 1, green: 0, blue: 0 } : { red: 0, green: 0, blue: 0 },
              },
            },
          },
          fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor",
        },
      });
    }
  }

  // values 一括更新
  if (valueUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: valueUpdates,
      },
    });
  }

  // format 一括更新
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests },
    });
  }

  console.log(`✅ ${sheetName} 更新完了`);
}


// export async function writeShiftUsers({ sheetName, timeLabel, users }) {
//   const sheets = getSheetsClient();
//   const SHEET_ID = process.env.GOOGLE_SHEET_ID;

//   // sheetIdを取得
//   const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
//   const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
//   if (!sheet) return;

//   const sheetId = sheet.properties.sheetId;

//   // 該当時間帯の行番号を取得
//   const times = await sheets.spreadsheets.values.get({
//     spreadsheetId: SHEET_ID,
//     range: `${sheetName}!A:A`,
//   });
//   const row = (times.data.values || []).findIndex(r => r[0] === timeLabel);
//   if (row === -1) return;

//   const requests = [];

//   // 行全体を初期化
//   requests.push({
//     repeatCell: {
//       range: {
//         sheetId,
//         startRowIndex: row,
//         endRowIndex: row + 1,
//         startColumnIndex: 2, // C列
//         endColumnIndex: 6,   // F列
//       },
//       cell: {
//         userEnteredFormat: {
//           backgroundColor: null,
//           textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } },
//         },
//       },
//       fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor",
//     },
//   });

//   // ユーザー名を反映
//   const names = [["", "", "", ""]];
//   users.forEach(u => {
//     names[0][u.col] = u.name;
//   });
//   await sheets.spreadsheets.names.update({
//     spreadsheetId: SHEET_ID,
//     range: `${sheetName}!C${row + 1}:F${row + 1}`,
//     valueInputOption: "USER_ENTERED",
//     requestBody: { names },
//   });

//   // 飛び枠の着色
//   for (const u of users) {
//     requests.push({
//       repeatCell: {
//         range: {
//           sheetId,
//           startRowIndex: row,
//           endRowIndex: row + 1,
//           startColumnIndex: 2 + u.col,
//           endColumnIndex: 3 + u.col,
//         },
//         cell: {
//           userEnteredFormat: {
//             ...(u.needBg && u.bgColor ? { backgroundColor: u.bgColor } : {}),
//             textFormat: {
//               foregroundColor: u.isEncore
//                 ? { red: 1, green: 0, blue: 0 }
//                 : { red: 0, green: 0, blue: 0 },
//             },
//           },
//         },
//         fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor",
//       },
//     });
//   }

//   // リアクション数が最大列数よりも多い場合
//   if (users.length > MAX_COLUMNS) {
//     // 空欄にする
//     const redValues = [["", "", "", ""]];
//     await sheets.spreadsheets.values.update({
//       spreadsheetId: SHEET_ID,
//       range: `${sheetName}!C${row + 1}:F${row + 1}`,
//       valueInputOption: "USER_ENTERED",
//       requestBody: { values: redValues },
//     });

//     // 背景色を赤にする
//     requests.push({
//       repeatCell: {
//         range: {
//           sheetId,
//           startRowIndex: row,
//           endRowIndex: row + 1,
//           startColumnIndex: 2,
//           endColumnIndex: 6,
//         },
//         cell: {
//           userEnteredFormat: {
//             backgroundColor: { red: 1, green: 0, blue: 0 },
//           },
//         },
//         fields: "userEnteredFormat.backgroundColor",
//       },
//     });
//   }

//   // 反映
//   if (requests.length > 0) {
//     await sheets.spreadsheets.batchUpdate({
//       spreadsheetId: SHEET_ID,
//       requestBody: { requests },
//     });
//   }

//   console.log(`✅ ${sheetName} ${timeLabel} 更新完了`);
// }
