'use strict';
const { getBot } = require('../../lib/telegram/bot');

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  // اختبارات سريعة بالمتصفح
  if (req.method === 'GET') {
    const hasToken = !!(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN);
    return res.status(200).json({ ok: true, webhook: 'telegram', hasToken });
  }

  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    // اقرأ البودي أولاً
    const update = req.body && Object.keys(req.body).length
      ? req.body
      : await readJson(req);

    // ارجع 200 بسرعة لتيليجرام
    res.status(200).end();

    // تحقّق من التوكن قبل تهيئة البوت/المعالجة
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    if (!token) {
      console.error('Missing TELEGRAM_BOT_TOKEN/BOT_TOKEN');
      return;
    }

    const bot = getBot();            // تهيئة كسولة + Singleton
    await bot.handleUpdate(update);  // بدون bot.launch()
  } catch (e) {
    console.error('webhook-error', e);
    // الرد انتهى بالفعل؛ فقط سجّل الخطأ
  }
};
