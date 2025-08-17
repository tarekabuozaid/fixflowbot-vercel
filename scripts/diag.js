// تقرير سريع: getMe + getWebhookInfo
const base = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
(async () => {
  if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN missing');
    process.exit(1);
  }
  const [me, wh] = await Promise.all([
    fetch(`${base}/getMe`).then(r => r.json()),
    fetch(`${base}/getWebhookInfo`).then(r => r.json())
  ]);
  console.log('getMe ->', me);
  console.log('getWebhookInfo ->', wh);
})();
