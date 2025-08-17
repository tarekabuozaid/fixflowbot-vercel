// Webhook endpoint لـ Telegram على Vercel
const { Telegraf } = require('telegraf');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  throw new Error('BOT_TOKEN is missing');
}

const bot = new Telegraf(TOKEN);

// أوامر أساسية
bot.start(ctx => ctx.reply('Bot ready ✅'));
bot.command('ping', ctx => ctx.reply('pong'));
bot.on('text', ctx => ctx.reply(`Echo: ${ctx.message.text}`));

module.exports = async (req, res) => {
  // Health check
  if (req.method === 'GET') {
    res.status(200).json({ 
      ok: true, 
      status: 'alive', 
      time: new Date().toISOString(),
      bot: 'FixFlowBot'
    });
    return;
  }

  // Webhook handling
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body, res);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Webhook error:', err);
      res.status(200).json({ ok: false, error: err.message });
    }
    return;
  }

  // Method not allowed
  res.status(405).json({ error: 'Method not allowed' });
};
