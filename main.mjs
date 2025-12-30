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

/* =========================
 * 起動直後ログ
 * ========================= */
console.log("🚀 main.mjs start");
console.log("🕒 start time:", new Date().toISOString());

dotenv.config();

console.log("🔐 ENV CHECK");
console.log("DISCORD_TOKEN exists:", !!process.env.DISCORD_TOKEN);
console.log("GOOGLE_PRIVATE_KEY exists:", !!process.env.GOOGLE_PRIVATE_KEY);
console.log("PORT:", process.env.PORT);

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
console.log("📦 Loading slash commands...");

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

console.log(`📦 読み込んだコマンド数: ${client.commands.size}`);

/* =========================
 * Discord イベント監視
 * ========================= */

// READY
client.once(Events.ClientReady, (c) => {
  console.log("✅ ClientReady fired");
  console.log(`🎉 Logged in as ${c.user.tag}`);
  console.log("🆔 Bot ID:", c.user.id);
  console.log("🏠 Guild count:", c.guilds.cache.size);

  console.log("⏰ startShiftCron を開始します");
  startShiftCron(client, SHIFT_DEFINITIONS, async (targets) => {
    console.log("🖼 cron postShiftImages start");
    await postShiftImages({
      mode: "cron",
      client,
      shiftDefinitions: targets,
    });
  });
});

// デバッグ系
client.on("debug", (info) => {
  console.log("🐞 DISCORD DEBUG:", info);
});

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
 * Message Command (!us)
 * ========================= */
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content.trim() !== "!us") return;

  console.log("✉️ !us received");

  try {
    for (const def of SHIFT_DEFINITIONS) {
      await collectShift(client, def);
    }

    await postShiftImages({
      mode: "message",
      client,
      shiftDefinitions: SHIFT_DEFINITIONS,
      triggerMessage: message,
    });
  } catch (err) {
    console.error("❌ !us error:", err);
    await message.reply("❌ シフト更新中にエラーが発生しました。");
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
process.on("unhandledRejection", (reason) => {
  console.error("🔥 unhandledRejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("🔥 uncaughtException:", err);
});

process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received");
  client.destroy();
  process.exit(0);
});
