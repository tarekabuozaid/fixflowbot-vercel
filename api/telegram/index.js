'use strict';

module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Telegram webhook endpoint working',
    timestamp: new Date().toISOString()
  });
};
