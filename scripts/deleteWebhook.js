const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/deleteWebhook`;
(async () => {
  if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN missing');
    process.exit(1);
  }
  const r = await fetch(url, { method: 'POST' });
  const j = await r.json();
  console.log('deleteWebhook ->', j);
})();
