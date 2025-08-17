// Webhook endpoint لـ Telegram على Vercel
const { Telegraf } = require('telegraf');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  // على Vercel: لازم تضيف BOT_TOKEN من الداشبورد
  throw new Error('BOT_TOKEN is missing');
}
const bot = new Telegraf(TOKEN);

// أوامر أساسية
bot.start(ctx => ctx.reply('Bot ready ✅'));
bot.command('ping', ctx => ctx.reply('pong'));
bot.on('text', ctx => ctx.reply(`Echo: ${ctx.message.text}`));

// قراءة جسم الطلب يدويًا (مضمون على Vercel)
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
  });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    // Health check
    res.status(200).json({ ok: true, status: 'alive', time: new Date().toISOString() });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const update = await readBody(req);
    await bot.handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('handleUpdate error:', err);
    // نرجّع 200 عشان تيليجرام ما يكرر الإدخال بشكل مبالغ
    res.status(200).json({ ok: false, error: 'handler_failed' });
  }
};
