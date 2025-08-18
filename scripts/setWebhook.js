// scripts/setWebhook.js
const token = process.env.BOT_TOKEN;
const base  = process.env.PUBLIC_URL;

if (!token || !base) {
  console.error('BOT_TOKEN or PUBLIC_URL missing');
  process.exit(1);
}

const url = `${base.replace(/\/$/, '')}/api/telegram`;

(async () => {
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 40
    })
  });
  const j = await r.json();
  console.log(j);
})();