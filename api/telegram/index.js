'use strict';

const { getBot } = require('../../lib/telegram/bot');

// Load environment variables from .env if present
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {
    // dotenv is optional; ignore if not installed
  }
}

module.exports = async (req, res) => {
  // Telegram sends POST only
  if (req.method !== 'POST') {
    res.status(200).send('OK');
    return;
  }

  // Log incoming update for debugging
  console.log('update-in', { 
    id: req.body?.update_id, 
    type: Object.keys(req.body || {}).filter(k => k !== 'update_id')[0] || 'unknown',
    from: req.body?.message?.from?.id || req.body?.callback_query?.from?.id
  });

  // IMPORTANT: Return 200 immediately to avoid timeout
  res.status(200).end();

  try {
    const update = req.body;
    const bot = getBot();
    await bot.handleUpdate(update);
  } catch (e) {
    console.error('Webhook error:', e);
  }
};
