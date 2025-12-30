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

dotenv.config();

console.log("TOKEN exists:", !!process.env.DISCORD_TOKEN);
console.log("PRIVATE KEY exists:", !!process.env.GOOGLE_PRIVATE_KEY);

// ===============================
// パス設定
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// Discord Client
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();

// ===============================
// コマンド読み込み
// ===============================
const commandFiles = readdirSync(path.join(__dirname, "commands"))
  .filter(file => file.endsWith(".mjs"));

for (const file of commandFiles) {
  const { command, execute } = await import(`./commands/${file}`);
  if (!command) continue;
  client.commands.set(command.name, { data: command, execute });
}

console.log(`📦 読み込んだコマンド数: ${client.commands.size}`);

// ===============================
// Discord Events（重要）
// ===============================
client.once(Events.ClientReady, (c) => {
  console.log(`🎉 READY: ${c.user.tag} (${c.user.id})`);

  startShiftCron(
    client,
    SHIFT_DEFINITIONS,
    async (targets) => {
      await postShiftImages({
        mode: "cron",
        client,
        shiftDefinitions: targets,
      });
    }
  );
});

client.on("shardReady", (id) => {
  console.log(`🧩 Shard ${id} ready`);
});

client.on("shardDisconnect", (event, id) => {
  console.error(`⚠️ Shard ${id} disconnected`, event);
});

client.on("shardError", (error, id) => {
  console.error(`❌ Shard ${id} error`, error);
});

client.on("error", (error) => {
  console.error("❌ Discord client error:", error);
});

// ===============================
// Interaction
// ===============================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) {
    await interaction.reply({ content: "❌ 未知のコマンドです。", ephemeral: true });
    return;
  }

  try {
    await cmd.execute(interaction, client);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "❌ エラーが発生しました。", ephemeral: true });
    } else {
      await interaction.reply({ content: "❌ エラーが発生しました。", ephemeral: true });
    }
  }
});

// ===============================
// プロセス系
// ===============================
process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
});

process.on("SIGINT", () => {
  console.log("🛑 Botを終了しています...");
  client.destroy();
  process.exit(0);
});

// ===============================
// Discord Login
// ===============================
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN が未設定です");
  process.exit(1);
}

console.log("🔄 Discord に接続中...");

client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log("🔑 login() Promise resolved");
  })
  .catch(error => {
    console.error("❌ Discord login failed:", error);
    process.exit(1);
  });

// ===============================
// Express（Render用）
// ===============================
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    status: "Bot is running",
    uptime: process.uptime(),
    time: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`🌐 Web サーバーがポート ${port} で起動しました`);
});
