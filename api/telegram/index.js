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
  const bot = new Telegraf(token, { handlerTimeout: 9_000 });

  // أمر اختبار
  bot.command('ping', (ctx) => ctx.reply('pong ✅'));

  // رسالة ترحيب مؤقتة
  bot.start((ctx) => ctx.reply('FixFlowBot جاهز — اكتب /ping للتجربة'));

  // ثبّت الويبهوك (لو كان مختلف هيتحدّث)
  const webhookUrl = `${publicUrl}${webhookPath}`;
  bot.telegram.setWebhook(webhookUrl).catch(() => {});

  // هندلر الويبهوك
  const handle = bot.webhookCallback(webhookPath);

  module.exports = async (req, res) => {
    if (req.method !== 'POST') {
      // GET/HEAD للـ health البسيط على نفس المسار
      res.statusCode = 200;
      return res.end('OK');
    }
    return handle(req, res);
  };

  module.exports.config = { runtime: 'nodejs20' };
}
