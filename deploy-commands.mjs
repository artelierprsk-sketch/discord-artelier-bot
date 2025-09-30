import { REST, Routes } from "discord.js";
import "dotenv/config";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// __dirname の代替 (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// commands フォルダ内の全コマンドを読み込み
const commands = [];
const commandFiles = readdirSync(path.join(__dirname, "commands")).filter(file => file.endsWith(".mjs"));

for (const file of commandFiles) {
  const { command } = await import(`./commands/${file}`);
  commands.push(command.toJSON());
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("⏳ スラッシュコマンドを登録中...");
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ コマンド登録完了！");
  } catch (err) {
    console.error("❌ コマンド登録エラー:", err);
  }
})();
