import { Client, GatewayIntentBits, Events, Collection } from "discord.js";
import dotenv from "dotenv";
import express from "express";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startShiftCron } from "./schedulers/shiftCron.mjs";
// import { handleUpdateShift } from "./messageCommands/updateShift.mjs";
import { postShiftImages } from "./services/shiftImagePoster.mjs"; // ★ 追加
import { collectShift } from "./services/shiftCollector.mjs";
import { SHIFT_DEFINITIONS } from "./services/shiftDefinitions.mjs";

dotenv.config();
// console.log("GOOGLE_SHEET_ID:", process.env.GOOGLE_SHEET_ID);
console.log("TOKEN exists:", !!process.env.DISCORD_TOKEN);
console.log("PRIVATE KEY exists:", !!process.env.GOOGLE_PRIVATE_KEY);

// __dirname の代替 (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();

// commands フォルダのコマンドを読み込み
const commandFiles = readdirSync(path.join(__dirname, "commands"))
  .filter(file => file.endsWith(".mjs"));

for (const file of commandFiles) {
  const { command, execute } = await import(`./commands/${file}`);
  if (!command) continue;
  client.commands.set(command.name, { data: command, execute });
}

client.once(Events.ClientReady, (c) => {
  console.log(`🎉 ${c.user.tag} が正常に起動しました！`);

  startShiftCron(
    client,
    SHIFT_DEFINITIONS,
    async (targets) => {
      await postShiftImages({
        mode: "cron",
        client,
        shiftDefinitions: targets, // ★ 期限内のみ
      });
    }
  );
});


client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content.trim() !== "!us") return;

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
    console.error(err);
    await message.reply("❌ シフト更新中にエラーが発生しました。");
  }
});

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
      await interaction.followUp({
        content: "❌ コマンド実行中にエラーが発生しました。",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "❌ コマンド実行中にエラーが発生しました。",
        ephemeral: true,
      });
    }
  }
});

// Discord クライアントエラー
client.on("error", (error) => {
  console.error("❌ Discord クライアントエラー:", error);
});

// プロセス終了時
process.on("SIGINT", () => {
  console.log("🛑 Botを終了しています...");
  client.destroy();
  process.exit(0);
});

// Discord にログイン
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN が .env ファイルに設定されていません！");
  process.exit(1);
}

console.log("🔄 Discord に接続中...");
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("❌ ログインに失敗しました:", error);
  process.exit(1);
});

// Express Webサーバー（Render用）
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    status: "Bot is running! 🤖",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`🌐 Web サーバーがポート ${port} で起動しました`);
});
