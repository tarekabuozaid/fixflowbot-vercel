// يظبط الويبهوك على Vercel URL
const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook`;
const target = `${process.env.PUBLIC_URL}/api/telegram`;
(async () => {
  if (!process.env.BOT_TOKEN || !process.env.PUBLIC_URL) {
    console.error('❌ BOT_TOKEN or PUBLIC_URL missing');
    process.exit(1);
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: target, allowed_updates: ['message'] })
  });
  const j = await r.json();
  console.log('setWebhook ->', j);
})();
