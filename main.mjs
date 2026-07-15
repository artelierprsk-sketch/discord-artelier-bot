import { Client, GatewayIntentBits, Events, Collection } from "discord.js";
import dotenv from "dotenv";
import express from "express";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startShiftCron } from "./schedulers/shiftCron.mjs";
import { postShiftImages } from "./services/shiftImagePoster.mjs";
import { collectShift } from "./services/shiftCollector.mjs";
import { SHIFT_DEFINITIONS } from "./services/shiftDefinitions.mjs";
import { startTransitionCron } from "./schedulers/transitionCron.mjs";
import { startMessagePostCron, setupMessageFixWatcher } from "./schedulers/messagePostCron.mjs";

console.log("🚀 main.mjs start");

dotenv.config();

/* =========================
 * __dirname (ESM)
 * ========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
 * Discord Client
 * ========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();

/* =========================
 * コマンド読込
 * ========================= */
const commandFiles = readdirSync(path.join(__dirname, "commands"))
  .filter(file => file.endsWith(".mjs"));

for (const file of commandFiles) {
  try {
    const { command, execute } = await import(`./commands/${file}`);
    if (!command) continue;
    client.commands.set(command.name, { data: command, execute });
  } catch (err) {
    console.error(`❌ Failed to load command: ${file}`, err);
  }
}

/* =========================
 * Discord イベント監視
 * ========================= */

// READY
client.once(Events.ClientReady, (c) => {

  //シフト表自動更新
  if (process.env.SHIFT_COLLECTOR_USE === "true") {
    startShiftCron(client, SHIFT_DEFINITIONS, async (targets) => {
      console.log("🖼 cron postShiftImages start");
      await postShiftImages({
        mode: "cron",
        client,
        shiftDefinitions: targets,
      });
    });
  }

  //交代確認
  if (process.env.SHIFT_TRANSITION_ANNOUNCE_USE === "true") {
    startTransitionCron(client);
  }

  // メッセージ自動投稿
  if (process.env.MESSAGE_POST_USE === "true") {
    startMessagePostCron(client);
    setupMessageFixWatcher(client);
  }
});

// デバッグ系
// client.on("debug", (info) => {
//   console.log("🐞 DISCORD DEBUG:", info);
// });

client.on("warn", (info) => {
  console.warn("⚠️ DISCORD WARN:", info);
});

client.on("error", (error) => {
  console.error("❌ DISCORD ERROR:", error);
});

// Shard / Gateway
client.on("shardReady", (id) => {
  console.log(`🧩 Shard ${id} READY`);
});

client.on("shardDisconnect", (event, id) => {
  console.error(`🔌 Shard ${id} DISCONNECTED`, event);
});

client.on("shardReconnecting", (id) => {
  console.log(`🔄 Shard ${id} reconnecting`);
});

client.on("shardError", (error, id) => {
  console.error(`❌ Shard ${id} error`, error);
});

/* =========================
 * Message Command
 * ========================= */
// client.on(Events.MessageCreate, async (message) => {
//   if (message.author.bot) return;
//   if (message.content.trim() !== "!us") return;

//   console.log("✉️ !us received");

//   try {
//     for (const def of SHIFT_DEFINITIONS) {
//       await collectShift(client, def);
//     }

//     await postShiftImages({
//       mode: "message",
//       client,
//       shiftDefinitions: SHIFT_DEFINITIONS,
//       triggerMessage: message,
//     });
//   } catch (err) {
//     console.error("❌ !us error:", err);
//     await message.reply("❌ シフト更新中にエラーが発生しました。");
//   }
// });

/* =========================
 * Message Command (!recruit m-n)
 * ========================= */
client.on(Events.MessageCreate, async (message) => {
  if (process.env.SHIFT_RECRUIT_USE !== "true") return;
  if (message.author.bot) return;
  if (message.author.id != process.env.USER_ADMIN_ID) return; //荒らし防止で管理者のみに限定

  const match = message.content.trim().match(/^!recruit\s+(\d+)-(\d+)$/);
  if (!match) return;

  const start = Number(match[1]);
  const end = Number(match[2]);

  if (start >= end) {
    await message.reply("❌ 範囲指定が正しくありません。（例: !recruit 15-18）");
    return;
  }

  try {
    for (let i = start; i < end; i++) {
      const text = `${i}-${i + 1}`;
      const sent = await message.channel.send(text);

      // リアクション追加
      await sent.react("🟢");
      if (process.env.SHIFT_RECRUIT_INCLUDE_ENCORE === "true") {
        await sent.react("🟣");
      }
    }
  } catch (err) {
    console.error("❌ !recruit error:", err);
    await message.reply("❌ 募集メッセージの投稿中にエラーが発生しました。");
  }
});

/* =========================
 * Message Command (!daily YYYY/M/D-YYYY/M/D)
 * ========================= */
client.on(Events.MessageCreate, async (message) => {
  if (process.env.DAILY_USE !== "true") return;
  if (message.author.bot) return;
  if (message.author.id != process.env.USER_ADMIN_ID) return; // 管理者のみ

  const INCLUDE_CHALLANGELIVE = (process.env.DAILY_INCLUDE_CHALLANGELIVE === "true");
  const INCLUDE_MYSEKAI = (process.env.DAILY_INCLUDE_MYSEKAI === "true");

  const SYMBOL_CHALLANGELIVE = "🎁";
  const SYMBOL_MYSEKAI_AM = "🌅";
  const SYMBOL_MYSEKAI_PM = "🌃";

  const match = message.content.trim().match(
    /^!daily\s+(\d{4})\/(\d{1,2})\/(\d{1,2})-(\d{4})\/(\d{1,2})\/(\d{1,2})$/
  );
  if (!match) return;

  const startDate = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

  const endDate = new Date(
    Number(match[4]),
    Number(match[5]) - 1,
    Number(match[6])
  );

  if (startDate > endDate) {
    await message.reply("❌ 日付範囲が正しくありません。（例: !daily 2026/2/28-2026/3/8）");
    return;
  }

  const week = ["日", "月", "火", "水", "木", "金", "土"];

  try {
    const current = new Date(startDate);
    let text = ``;
    if (INCLUDE_CHALLANGELIVE) {
      text += `\r\n${SYMBOL_CHALLANGELIVE}:チャレライ`;
    }
    if (INCLUDE_MYSEKAI) {
      text += `\r\n${SYMBOL_MYSEKAI_AM}:マイセカイ(5-17)`;
      text += `\r\n${SYMBOL_MYSEKAI_PM}:マイセカイ(17-5)`;
    }
    // 先頭の\r\nを除去
    text = text.replace(/^\r\n/, '');
    const sent = await message.channel.send(text);
    const sent2 = await message.channel.send(`――――――――――――――――――――`);

    while (current <= endDate) {
      const month = current.getMonth() + 1;
      const day = current.getDate();
      const dayOfWeek = week[current.getDay()];

      const text = `${month}月${day}日(${dayOfWeek})`;
      const sent = await message.channel.send(text);

      // リアクション追加
      if (INCLUDE_CHALLANGELIVE) {
        await sent.react("🎁");
      }
      if (INCLUDE_MYSEKAI) {
        await sent.react("🌅");
        await sent.react("🌃");
      }

      // 次の日へ
      current.setDate(current.getDate() + 1);
    }
  } catch (err) {
    console.error("❌ !daily error:", err);
    await message.reply("❌ dailyメッセージの投稿中にエラーが発生しました。");
  }
});

/* =========================
 * Slash Commands
 * ========================= */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log("💬 Slash command:", interaction.commandName);

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) {
    await interaction.reply({ content: "❌ 未知のコマンドです。", ephemeral: true });
    return;
  }

  try {
    await cmd.execute(interaction, client);
  } catch (error) {
    console.error("❌ Slash command error:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "❌ エラーが発生しました。", ephemeral: true });
    } else {
      await interaction.reply({ content: "❌ エラーが発生しました。", ephemeral: true });
    }
  }
});

/* =========================
 * Discord Login
 * ========================= */
console.log(`token ${process.env.DISCORD_TOKEN}`);
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing");
  process.exit(1);
}

console.log("🔄 Discord login start");

client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log("🟢 client.login() resolved");
  })
  .catch((error) => {
    console.error("🔴 client.login() rejected", error);
    process.exit(1);
  });

/* =========================
 * Express (Render keep-alive)
 * ========================= */
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    status: "Bot is running",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`🌐 Web server listening on ${port}`);
});

/* =========================
 * Process events
 * ========================= */
// process.on("unhandledRejection", (reason) => {
//   console.error("🔥 unhandledRejection:", reason);
// });

// process.on("uncaughtException", (err) => {
//   console.error("🔥 uncaughtException:", err);
// });

// process.on("SIGTERM", () => {
//   console.log("🛑 SIGTERM received");
//   client.destroy();
//   process.exit(0);
// });
