// api/telegram/index.js
const { Telegraf } = require('telegraf');

const token = process.env.BOT_TOKEN;
const publicUrl = process.env.PUBLIC_URL;
const webhookPath = '/api/telegram';

if (!token || !publicUrl) {
  module.exports = (req, res) => {
    res.statusCode = 500;
    return res.end('Missing BOT_TOKEN or PUBLIC_URL');
  };
  module.exports.config = { runtime: 'nodejs20' };
} else {
  const bot = new Telegraf(token, { handlerTimeout: 9000 });

  // لوج لأي خطأ داخل تيليجراف
  bot.catch((err, ctx) => {
    console.error('TELEGRAM_ERROR', { update: ctx.update, err: err.message });
  });

  // أمر اختبار
  bot.command('ping', (ctx) => ctx.reply('pong ✅'));

  // رد عام يساعدنا نتاكد ان الويبهوك بيوصل
  bot.on('message', (ctx) => {
    // لو اللي مبعوت /ping هيرد أعلاه، غير كده هيرد الرسالة دي
    if (!ctx.message.text?.startsWith('/')) {
      ctx.reply('👋 bot online — اكتب /ping للتجربة');
    }
  });

  // اضبط الويبهوك (لو متضبط مش هيتغير)
  const webhookUrl = `${publicUrl}${webhookPath}`;
  bot.telegram.setWebhook(webhookUrl).catch(() => {});

  const handle = bot.webhookCallback(webhookPath);

  module.exports = async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 200;
      return res.end('OK');
    }
    return handle(req, res);
  };

  module.exports.config = { runtime: 'nodejs20' };
}
