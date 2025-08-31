'use strict';

const prisma = require('../../lib/telegram/services/_db');

module.exports = async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ 
      ok: true, 
      timestamp: new Date().toISOString(),
      service: 'FixFlow Bot API'
    });
  } catch (e) {
    res.status(500).json({ 
      ok: false, 
      error: String(e?.message || e),
      timestamp: new Date().toISOString()
    });
  }
};