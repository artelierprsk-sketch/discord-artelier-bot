import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs";
import path from "path";

// ファイルからランダムに1行取得する関数
function getRandomLine(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8").trim().split("\n");
    if (data.length === 0) return null;
    return data[Math.floor(Math.random() * data.length)].trim();
  } catch (err) {
    console.error(`❌ ${filePath} の読み込みに失敗しました:`, err);
    return null;
  }
}

export const command = new SlashCommandBuilder()
  .setName("omikuji")
  .setDescription("今日の運勢を占います");

export async function execute(interaction) {
  // 運勢の抽選確率
  const fortuneList = [
    { name: "大吉", rate: 0.10 },
    { name: "中吉", rate: 0.20 },
    { name: "小吉", rate: 0.30 },
    { name: "末吉", rate: 0.30 },
    { name: "凶", rate: 0.10 },
  ];

  // 抽選処理
  const r = Math.random();
  let fortune = "？";
  let cumulative = 0;
  for (const f of fortuneList) {
    cumulative += f.rate;
    if (r <= cumulative) {
      fortune = f.name;
      break;
    }
  }

  // 各ファイルのパス（/data 配下）
  const dataDir = path.join(process.cwd(), "data");
  const colorPath = path.join(dataDir, "lucky_colors.txt");
  const itemPath = path.join(dataDir, "lucky_items.txt");
  const songPath = path.join(dataDir, "lucky_songs.txt");

  // ランダム抽選
  const color = getRandomLine(colorPath) || "？？？";
  const item = getRandomLine(itemPath) || "？？？";
  const songLine = getRandomLine(songPath) || "？？？,https://youtu.be/";

  // 曲名とURLを分離
  const [songNameRaw, songUrlRaw] = songLine.split(/,(.+)/);
  let songName = songNameRaw?.trim() || "不明";
  const songUrl = songUrlRaw?.trim() || "https://youtu.be/";

  // songName = songName.replace(/([A-Z])\.([A-Z])/g, "$1\u200B.$2");

  // 結果文
  const resultText =
    `結果は…  **${fortune}** だって。\n` +
    `ラッキーカラーは **${color}** みたい。\n` + 
    ` **${item}** を食べると運勢が上がるかも。良かったら探してみて。\n` +
    `ラッキーソングもあるから、聴いてみても良いかもね。\n\n${songUrl}`;

  // Embed の色をラッキーカラーに近い色に（よく使われる色名対応）
  const COLOR_MAP = {
    赤: "#FF0000",
    青: "#0000FF",
    緑: "#00FF00",
    黄色: "#FFFF00",
    オレンジ: "#FFA500",
    紫: "#800080",
    ピンク: "#FFC0CB",
    白: "#FFFFFF",
    黒: "#000000",
  };
  const embedColor = COLOR_MAP[color] || "#FFD700";

  // Embed 作成
  const embed = new EmbedBuilder()
    .setTitle("おみくじ")
    .setDescription(resultText)
    .setColor(embedColor)
    .setFooter({ text: `${songName}` });

  await interaction.reply({ embeds: [embed] });
}
