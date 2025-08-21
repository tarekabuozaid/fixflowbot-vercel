// api/health.js (Node.js, CommonJS)
const { PrismaClient } = require('@prisma/client');
const g = globalThis;
const prisma = g._prisma ?? new PrismaClient();
if (!g._prisma) g._prisma = prisma;

module.exports = async (req, res) => {
  try {
    const row = await prisma.$queryRaw`SELECT 1 as ok`;
    res.status(200).json({
      ok: true,
      db: !!(row && row[0] && row[0].ok),
      ts: new Date().toISOString(),
    });
  } catch (e) {
    console.error('HEALTH_ERROR', e);
    res.status(200).json({ ok: false, db: false, error: 'db_unreachable' });
  }
};
