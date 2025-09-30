import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle } from "discord.js";

export const command = new SlashCommandBuilder()
  .setName("tweet")
  .setDescription("ツイ募用リンクを生成します");

export async function execute(interaction, client) {
  const tweet_message_id = "1422238827103387648";
  const runmemo_channel_id = "1420884330275672125";
  const room_channel_id = "1420896599038623986";

  try {
    const roomChannel = await client.channels.fetch(room_channel_id);
    const channelName = roomChannel.name;
    const aryRoomNo = channelName.match(/【\d{5}】/);

    if (!aryRoomNo) {
      await interaction.reply({ content: "❌ 部屋番号が見つかりませんでした。", ephemeral: true });
      return;
    }
    const roomNo = aryRoomNo[0];

    const runMemoChannel = await client.channels.fetch(runmemo_channel_id);
    const targetMessage = await runMemoChannel.messages.fetch(tweet_message_id);

    let text = targetMessage.content.replace("【】", roomNo);
    text = encodeURIComponent(text);

    const tweetUrl = "https://twitter.com/intent/tweet?text=" + text;
    if (tweetUrl.length > 512) {
      await interaction.reply({ content: `❌ 本文が長すぎます (${tweetUrl.length}文字)`, ephemeral: true });
      return;
    }

    const msg =
      "以下のボタンをクリックすると、ツイ募のツイート画面が開きます。\n※リンクを開くだけでツイートは行われません。\n※「周回メモ」チャンネルのメッセージに部屋番号を自動反映してリンクを生成しています。";

    const embed = new EmbedBuilder()
      .setTitle("ツイ募用リンク")
      .setDescription(msg)
      .setColor("#1DA1F2");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Twitterのツイート画面を開く")
        .setURL(tweetUrl)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error("❌ /tweet 実行中にエラー:", error);
    await interaction.reply({
      content: "❌ 実行中にエラーが発生しました。チャンネルIDや権限を確認してください。",
      ephemeral: true,
    });
  }
}
