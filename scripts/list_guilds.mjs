import 'dotenv/config';

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('DISCORD_TOKEN missing'); process.exit(1); }

(async () => {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bot ${token}` },
    });
    const json = await res.json();
    console.log('HTTP', res.status);
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
