import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { google } from "googleapis";
import { SHIFT_DEFINITIONS } from "../services/shiftDefinitions.mjs";

const ADMIN_REACTION = "🌸";

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

function toColumnLetter(columnNumber) {
  let letter = "";
  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }
  return letter;
}

async function getSheetMetadata(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: false,
    fields: "sheets.properties",
  });
  const sheet = response.data.sheets?.find((item) => item.properties?.title === sheetName);
  if (!sheet?.properties) {
    throw new Error(`シート「${sheetName}」が見つかりません。`);
  }
  return {
    sheetId: sheet.properties.sheetId,
    maxColumns: sheet.properties.gridProperties?.columnCount || 26,
  };
}

async function ensureSheetHasColumns(sheets, spreadsheetId, sheetId, requiredColumns, currentColumns) {
  if (requiredColumns <= currentColumns) {
    return currentColumns;
  }
  const addCount = requiredColumns - currentColumns;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          appendDimension: {
            sheetId,
            dimension: "COLUMNS",
            length: addCount,
          },
        },
      ],
    },
  });
  return requiredColumns;
}

async function safeReply(interaction, options) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(options);
    }
    return await interaction.reply(options);
  } catch (error) {
    console.error("❌ interaction response failed:", error);
  }
}

export const command = new SlashCommandBuilder()
  .setName("administrator")
  .setDescription("管理者向けコマンドメニュー");

export async function execute(interaction, client) {
  const adminId = process.env.USER_ADMIN_ID;

  if (interaction.user.id !== adminId) {
    await safeReply(interaction, { content: "❌ このコマンドは管理者のみ実行できます。", ephemeral: true });
    return;
  }

  try {
    const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("admin_menu")
    .setPlaceholder("実行するコマンドを選択してください")
    .addOptions(
      {
        label: "支援者様編成を収集",
        description: "未リアクションメッセージをGoogleスプレッドシートに反映",
        value: "collect_support_party",
      },
      {
        label: "シフト集計",
        description: "シフトチャンネルから未リアクションメッセージを集計",
        value: "shift_collection",
      }
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const response = await interaction.reply({
    content: "📋 以下のコマンドから実行するものを選択してください。",
    components: [row],
    ephemeral: true,
    fetchReply: true,
  });

  const collector = response.createMessageComponentCollector({ time: 5 * 60 * 1000 });

  collector.on("collect", async (selectInteraction) => {
    if (selectInteraction.user.id !== adminId) {
      await safeReply(selectInteraction, { content: "❌ 権限がありません。", ephemeral: true });
      return;
    }

    const selected = selectInteraction.values[0];

    if (selected === "collect_support_party") {
      await executeCollectSupportParty(selectInteraction, client);
    } else if (selected === "shift_collection") {
      await executeShiftCollection(selectInteraction, client);
    }

    collector.stop();
  });

  collector.on("end", () => {
    response.edit({ components: [] }).catch(() => {});
  });
  } catch (error) {
    console.error("❌ administrator command error:", error);
    await safeReply(interaction, {
      content: `❌ 管理者メニューの実行中にエラーが発生しました。原因: ${error?.message || JSON.stringify(error)}`,
      ephemeral: true,
    });
  }
}

async function executeCollectSupportParty(interaction, client) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const channelId = process.env.CHANNEL_SUPPORTER_PARTY_ID;
  const sheetName = "支援者様編成";

  if (!sheetId) {
    await interaction.reply({ content: "❌ 環境変数 GOOGLE_SHEET_ID が設定されていません。", ephemeral: true });
    return;
  }
  if (!channelId) {
    await interaction.reply({ content: "❌ 環境変数 CHANNEL_SUPPORTER_PARTY_ID が設定されていません。", ephemeral: true });
    return;
  }
  if (!client.user?.id) {
    await interaction.reply({ content: "❌ ボット情報の取得に失敗しました。", ephemeral: true });
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased()) {
      await interaction.reply({ content: "❌ 対象チャンネルがテキストチャンネルではありません。", ephemeral: true });
      return;
    }

    const messages = [];
    let lastId = undefined;
    while (true) {
      const batch = await channel.messages.fetch({ limit: 100, before: lastId });
      if (!batch.size) break;
      messages.push(...batch.values());
      if (batch.size < 100 || messages.length >= 500) break;
      lastId = batch.last().id;
    }

    const unreactedMessages = messages
      .filter((message) => !message.author?.bot)
      .filter((message) => {
        if (!message.reactions.cache.size) return true;
        return !message.reactions.cache.some((reaction) => reaction.me === true);
      });

    if (unreactedMessages.length === 0) {
      await interaction.reply({ content: "✅ 未リアクションのメッセージは見つかりませんでした。", ephemeral: true });
      return;
    }

    const sheets = getSheetsClient();

    const columnA = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A:A`,
    });
    const rowsA = columnA.data.values || [];
    const existingRowByUsername = new Map(rowsA.map((row, index) => [row[0]?.toString() || "", index + 1]));

    const uniqueMessagesByUsername = new Map();
    for (const message of unreactedMessages) {
      const username = message.author.username;
      const existing = uniqueMessagesByUsername.get(username);
      if (!existing || message.createdTimestamp > existing.createdTimestamp) {
        uniqueMessagesByUsername.set(username, message);
      }
    }

    const pattern = /\d{3}\/[^/]+\/\d{2}(?:\.\d)?/;
    const values = await Promise.all(
      Array.from(uniqueMessagesByUsername.values()).map(async (message) => {
        const content = message.content || "";
        const lines = content.split(/\r?\n/);
        let displayName = message.author.username;
        try {
          const member = await channel.guild.members.fetch(message.author.id);
          displayName = member.displayName || message.author.username;
        } catch (error) {
          console.warn(`⚠️ Failed to fetch member for ${message.author.username}:`, error);
        }
        const matchedParts = [];
        for (const line of lines) {
          const match = line.match(pattern);
          if (match) {
            matchedParts.push(match[0]);
          }
        }
        return [message.author.username, displayName, content, ...matchedParts];
      })
    );

    const existingUpdates = [];
    const newRows = [];

    values.forEach((rowValues) => {
      const username = rowValues[0];
      const existingRow = existingRowByUsername.get(username);
      if (existingRow) {
        existingUpdates.push({
          range: `${sheetName}!A${existingRow}`,
          values: [rowValues],
        });
      } else {
        newRows.push(rowValues);
      }
    });

    if (newRows.length > 0) {
      const firstEmptyRowIndex = rowsA.findIndex((row) => !row[0] || row[0].toString().trim() === "");
      const startRow = firstEmptyRowIndex === -1 ? rowsA.length + 1 : firstEmptyRowIndex + 1;
      existingUpdates.push({
        range: `${sheetName}!A${startRow}`,
        values: newRows,
      });
    }

    if (existingUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: existingUpdates,
        },
      });
    }

    await Promise.allSettled(
      Array.from(uniqueMessagesByUsername.values()).map((message) => message.react(ADMIN_REACTION))
    );

    await interaction.reply({
      content: `✅ ${Array.from(uniqueMessagesByUsername.values()).length} 件の未リアクションメッセージを「${sheetName}」に反映し、リアクションを付けました。`,
      ephemeral: true,
    });
  } catch (error) {
    console.error("❌ collect_support_party error:", error);
    await interaction.reply({ content: "❌ 支援者様編成の収集中にエラーが発生しました。ログを確認してください。", ephemeral: true });
  }
}

async function executeShiftCollection(interaction, client) {
  const sheetOptions = SHIFT_DEFINITIONS.map((def) => ({
    label: def.sheetName,
    value: def.key,
  }));

  if (sheetOptions.length === 0) {
    await safeReply(interaction, { content: "❌ シフト定義が見つかりません。", ephemeral: true });
    return;
  }

  const shiftSelectMenu = new StringSelectMenuBuilder()
    .setCustomId("shift_select")
    .setPlaceholder("対象の日付を選択してください")
    .addOptions(sheetOptions);

  const row = new ActionRowBuilder().addComponents(shiftSelectMenu);

  const response = await interaction.reply({
    content: "📅 集計対象の日付を選択してください。",
    components: [row],
    ephemeral: true,
    fetchReply: true,
  });

  const collector = response.createMessageComponentCollector({ time: 5 * 60 * 1000 });

  collector.on("collect", async (selectInteraction) => {
    const selectedKey = selectInteraction.values[0];
    const selectedDef = SHIFT_DEFINITIONS.find((def) => def.key === selectedKey);

    if (!selectedDef) {
      await safeReply(selectInteraction, { content: "❌ 選択されたシフト定義が見つかりません。", ephemeral: true });
      collector.stop();
      return;
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const { sheetName, channelId } = selectedDef;

    if (!sheetId) {
      await safeReply(selectInteraction, { content: "❌ 環境変数 GOOGLE_SHEET_ID が設定されていません。", ephemeral: true });
      collector.stop();
      return;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased()) {
        await safeReply(selectInteraction, { content: "❌ 対象チャンネルがテキストチャンネルではありません。", ephemeral: true });
        collector.stop();
        return;
      }

      const messages = [];
      let lastId = undefined;
      while (true) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
        if (!batch.size) break;
        messages.push(...batch.values());
        if (batch.size < 100 || messages.length >= 500) break;
        lastId = batch.last().id;
      }

      const unreactedMessages = messages
        .filter((message) => !message.author?.bot)
        .filter((message) => !message.reference)
        .filter((message) => {
          if (!message.reactions.cache.size) return true;
          return !message.reactions.cache.some((reaction) => reaction.me === true);
        });

      if (unreactedMessages.length === 0) {
        await safeReply(selectInteraction, { content: "✅ 未リアクションのメッセージは見つかりませんでした。", ephemeral: true });
        collector.stop();
        return;
      }

      await selectInteraction.deferUpdate();

      const sheets = getSheetsClient();
      const sheetMetadata = await getSheetMetadata(sheets, sheetId, sheetName);
      const sheetGid = sheetMetadata.sheetId;
      let maxColumns = sheetMetadata.maxColumns;

      const [columnAResp, row2Resp] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${sheetName}!A:A` }),
        sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${sheetName}!J2:ZZ2` }),
      ]);

      const columnA = columnAResp.data.values || [];
      const row2 = row2Resp.data.values?.[0] || [];
      const allocation = Array.from({ length: row2.length }, (_, index) => row2[index]?.toString().trim() !== "");

      const timeRangeRows = new Map();
      columnA.forEach((row, index) => {
        const value = row[0]?.toString().trim();
        if (value) {
          timeRangeRows.set(value, index + 1);
        }
      });

      const nextColumnIndex = async () => {
        for (let i = 0; i < allocation.length; i++) {
          if (!allocation[i]) {
            allocation[i] = true;
            return 9 + i;
          }
        }

        const nextIndex = 9 + allocation.length;
        const requiredColumnNumber = nextIndex + 1;
        maxColumns = await ensureSheetHasColumns(sheets, sheetId, sheetGid, requiredColumnNumber, maxColumns);

        allocation.push(true);
        return nextIndex;
      };

      const parseRanges = (text) => {
        const ranges = [];
        const seen = new Set();
        const regex = /(\d+)-(\d+)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const start = Number(match[1]);
          const end = Number(match[2]);
          if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
          for (let hour = start; hour < end; hour++) {
            const value = `${hour}-${hour + 1}`;
            if (!seen.has(value)) {
              seen.add(value);
              ranges.push(value);
            }
          }
        }
        return ranges;
      };

      const userEntries = Array.from(new Map(
        unreactedMessages
          .filter((message) => message.content && message.content.trim())
          .map((message) => [message.author.id, message])
      ).values());

      const firstEmptyARowIndex = columnA.findIndex((row, index) => index >= 2 && (!row[0] || row[0].toString().trim() === ""));
      const metaUsernameRow = firstEmptyARowIndex === -1 ? columnA.length + 1 : firstEmptyARowIndex + 1;
      const metaContentRow = metaUsernameRow + 1;

      const updates = [];
      let processedCount = 0;

      for (const message of userEntries) {
        let displayName = message.author.username;
        try {
          const member = await channel.guild.members.fetch(message.author.id);
          displayName = member.displayName || message.author.username;
        } catch (error) {
          console.warn(`⚠️ Failed to fetch member for ${message.author.username}:`, error);
        }
        const username = message.author.username;
        const content = message.content || "";
        const ranges = parseRanges(content);
        const columnIndex = await nextColumnIndex();
        const columnLetter = toColumnLetter(columnIndex + 1);

        updates.push({ range: `${sheetName}!${columnLetter}2`, values: [[displayName]] });

        for (const range of ranges) {
          const rowNumber = timeRangeRows.get(range);
          if (rowNumber) {
            updates.push({ range: `${sheetName}!${columnLetter}${rowNumber}`, values: [[displayName]] });
          }
        }

        updates.push({ range: `${sheetName}!${columnLetter}${metaUsernameRow}`, values: [[username]] });
        updates.push({ range: `${sheetName}!${columnLetter}${metaContentRow}`, values: [[content]] });

        processedCount += 1;
      }

      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: updates,
          },
        });
      }

      await Promise.allSettled(
        userEntries.map((message) => message.react(ADMIN_REACTION))
      );

      await safeReply(selectInteraction, {
        content: `✅ 「${sheetName}」に ${processedCount} 件の未リアクションメッセージを反映しました。`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("❌ shift_collection error:", error);
      await safeReply(selectInteraction, {
        content: `❌ シフト集計中にエラーが発生しました。原因: ${error?.message || JSON.stringify(error)}`,
        ephemeral: true,
      });
    }

    collector.stop();
  });

  collector.on("end", () => {
    response.edit({ components: [] }).catch(() => {});
  });
}

