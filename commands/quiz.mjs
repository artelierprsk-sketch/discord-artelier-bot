import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import fs from "fs";
import path from "path";

export const command = new SlashCommandBuilder()
  .setName("quiz")
  .setDescription("ランダムでクイズを生成します");

const UNIT_MAP = {
  "0_VS": "VirtualSinger",
  "1_L/n": "Leo/need",
  "2_MMJ": "MORE MORE JUMP！",
  "3_VBS": "Vivid BAD SQUAD",
  "4_WxS": "ワンダーランズ×ショウタイム",
  "5_25": "25時、ナイトコードで。",
  "9_oth": "その他"
};

const TYPE_MAP = {
  "既": "既存曲",
  "公": "公募曲",
  "書": "書き下ろし楽曲"
};

export async function execute(interaction, client) {
  // CSV読み込み
  const csvPath = path.join(process.cwd(), "prsk_music_namesorted.csv");
  let lines;
  try {
    const data = fs.readFileSync(csvPath, "utf8");
    lines = data.trim().split("\n");
    if (lines.length <= 2) throw new Error("対象行が足りません（最低3行必要）");
  } catch (err) {
    console.error(err);
    await interaction.reply({ content: "❌ CSV の読み込みに失敗しました。", ephemeral: true });
    return;
  }

  // ランダム問題番号
  const pos = Math.floor(Math.random() * (lines.length - 3)) + 1;

  // 問題文作成
  const fieldsAbove = lines[pos - 1].split(",");
  const fieldsBelow = lines[pos + 1].split(",");
  const charA = fieldsAbove[3]?.trim();
  const charB = fieldsBelow[3]?.trim();
  if (!charA || !charB) {
    await interaction.reply({ content: "❌ CSVの第4フィールドの値が存在しません", ephemeral: true });
    return;
  }
  const questionText = `50音順で「${charA}」と「${charB}」の間に来る楽曲は何？`;

  // Embed 作成
  const embed = new EmbedBuilder()
    .setTitle("50音順クイズ")
    .setDescription(questionText)
    .setColor("#FFA500");

  // ボタン作成
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`quiz_hint1_${pos}`)
      .setLabel("ヒント1")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`quiz_hint2_${pos}`)
      .setLabel("ヒント2")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`quiz_hint3_${pos}`)
      .setLabel("ヒント3")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`quiz_answer_${pos}`)
      .setLabel("答え")
      .setStyle(ButtonStyle.Success)
  );

  // 出題メッセージ送信
  const quizMessage = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  // ボタン押下処理
  const filter = i => i.isButton();
  const collector = interaction.channel.createMessageComponentCollector({ filter, time: 5 * 60 * 1000 });

  collector.on("collect", async i => {
    const [_, type, numberStr] = i.customId.split("_");
    const idx = parseInt(numberStr, 10);
    const fields = lines[idx].split(",");

    let replyText = "";

    if (type === "hint1") {
      const unitRaw = fields[4]?.trim();
      const unit = UNIT_MAP[unitRaw] || "不明";
      const typeRaw = fields[2]?.trim();
      const typeText = TYPE_MAP[typeRaw] || "不明";
      const mv = fields[16]?.trim() || "不明";

      replyText = `### ヒント1\n・ユニット: ${unit}\n・種別: ${typeText}\n・MV: ${mv}`;
    } else if (type === "hint2") {
      const implement = fields[18]?.trim() || "不明";
      const master = fields[9]?.trim() || "不明";
      const append = parseInt(fields[10], 10);
      replyText = `### ヒント2\n・実装時期: ${implement}\n・MASTER: ${master}`;
      if (!isNaN(append) && append > 0) {
        replyText += `\n・APPEND: ${append}`;
      }
    } else if (type === "hint3") {
      const producer = fields[19]?.trim() || "不明";
      replyText = `### ヒント3\n・作者: ${producer}`;
    } else if (type === "answer") {
      const music = fields[3]?.trim() || "不明";
      replyText = `### 答え\n${music}`;
    }

    // 出題メッセージへの返信として送信
    await i.channel.send({ content: replyText, reply: { messageReference: quizMessage.id } });

    // ボタンの反応を ACK
    await i.deferUpdate();
  });
}
