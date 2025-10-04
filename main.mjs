import { Client, GatewayIntentBits, Events, Collection } from "discord.js";
import dotenv from "dotenv";
import express from "express";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

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
const commandFiles = readdirSync(path.join(__dirname, "commands")).filter(file => file.endsWith(".mjs"));

for (const file of commandFiles) {
  const { command, execute } = await import(`./commands/${file}`);
  client.commands.set(command.name, { data: command, execute });
}

client.once(Events.ClientReady, (c) => {
  console.log(`🎉 ${c.user.tag} が正常に起動しました！`);
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
      await interaction.followUp({ content: "❌ コマンド実行中にエラーが発生しました。", ephemeral: true });
    } else {
      await interaction.reply({ content: "❌ コマンド実行中にエラーが発生しました。", ephemeral: true });
    }
  }
});

// Discord クライアントエラー
client.on('error', (error) => {
    console.error('❌ Discord クライアントエラー:', error);
  });
  
  // プロセス終了時の処理（SIGINT / Ctrl+C 対応）
  process.on('SIGINT', () => {
    console.log('🛑 Botを終了しています...');
    client.destroy();
    process.exit(0);
  });
  
  // Discord にログイン
  if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN が .env ファイルに設定されていません！');
    process.exit(1);
  }
  
  console.log('🔄 Discord に接続中...');
  client.login(process.env.DISCORD_TOKEN)
    .catch(error => {
      console.error('❌ ログインに失敗しました:', error);
      process.exit(1);
    });
  
  // Express Webサーバー設定（Render 用）
  const app = express();
  const port = process.env.PORT || 3000;
  
  // ヘルスチェック用エンドポイント
  app.get('/', (req, res) => {
    res.json({
      status: 'Bot is running! 🤖',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });
  
  // サーバー起動
  app.listen(port, () => {
    console.log(`🌐 Web サーバーがポート ${port} で起動しました`);
  });



  //memo 
  // git add .
  // git commit -m "test"
  // git push origin main
