// main.mjs - Discord Botのメインプログラム

// 必要なライブラリを読み込み
import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import express from 'express';

// .envファイルから環境変数を読み込み
dotenv.config();

// Discord Botクライアントを作成
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,           // サーバー情報取得
        GatewayIntentBits.GuildMessages,    // メッセージ取得
        GatewayIntentBits.MessageContent,   // メッセージ内容取得
        GatewayIntentBits.GuildMembers,     // メンバー情報取得
    ],
});

// Botが起動完了したときの処理
client.once('ready', () => {
    console.log(`🎉 ${client.user.tag} が正常に起動しました！`);
    console.log(`📊 ${client.guilds.cache.size} つのサーバーに参加中`);
});

// メッセージが送信されたときの処理
client.on('messageCreate', async (message) => {
    const tweet_message_id = 1422238827103387648;
    const runmemo_channel_id = 1420884330275672125;
    const room_channel_id = 1420896599038623986;

    // Bot自身のメッセージは無視
    if (message.author.bot) return;

    //メッセージを取得
    var content = message.content;
    console.log(message.content);
    if (content.startsWith('！')) content = '!' + content.slice(1) ;
    
    // 「ping」メッセージに反応
    // if (message.content.toLowerCase() === 'ping') {
    //     message.reply('🏓 pong!');
    //     console.log(`📝 ${message.author.tag} が ping コマンドを使用`);
    // }

    if (content == "!tweet") {
        // message.channel.send("test");

        //部屋番号を入手
        // var channelName = client.channels.fetch.get(room_channel_id).name;
        const channel = await client.channels.fetch(room_channel_id);
        const channelName = channel.name;
        var pattern = /【\d{5}】/;
        var aryRoomNo = channelName.match(pattern);

        var roomNo = "";
        if (aryRoomNo != null) {
            roomNo = aryRoomNo[0];
        }
        if (roomNo == "") return ;
        console.log(roomNo);

        client.channels.cache
            .get(runmemo_channel_id)
            .messages.fetch(tweet_message_id)
            .then(function(targetmessage) {
                var text = targetmessage.content;
                text = text,replace("【】", roomNo);
                text = encodeURIComponent(text);
                const tweetUrl = "https://twitter.com/intent/tweet?text=" + text ;

                const len = tweetUrl.length;
                if (len > 512) {
                    message.channel.send(`本文が長すぎるためリンクを生成できませんでした。 (${len}文字)`);
                    return;
                };

                const { MessageActionRow, MessageButton, MessageEmbed } = require('discord.js');
                const msg = "以下のボタンをクリックすると、ツイ募のツイート画面が開きます。"
                  + "\r※リンクを開くだけではツイートまでは行われません。ツイート画面が開くだけです。"
                  + "\r※「周回メモ」チャンネルのメッセージに、部屋番号を自動反映してリンクを生成しています。";

                const embed = new MessageEmbed()
                .setTitle("ツイ募用リンク")
                .setDescription(msg)
                .setColor("#1DA1F2");

                const row = new MessageActionRow().addComponents(
                  new MessageButton()
                  .setStyle("LINK")
                  .setLabel("Twitterのツイート画面を開く")
                  .setURL(tweetUrl)
                );
                
                message.channel.send({
                  embeds: [embed],
                  components: [row]
                });             
            });
    } ;
});

// エラーハンドリング
client.on('error', (error) => {
    console.error('❌ Discord クライアントエラー:', error);
});

// プロセス終了時の処理
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

// Express Webサーバーの設定（Render用）
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