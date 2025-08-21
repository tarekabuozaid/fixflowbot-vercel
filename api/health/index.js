// api/health/index.js

// Health endpoint that also checks database connectivity via Prisma
// Note: This file uses Prisma client to perform a simple query (`SELECT 1`) to
// verify that the database connection configured via the `DATABASE_URL` environment
// variable is working. If the query succeeds, the response will include
// "db": true; otherwise it remains false and the error message is included.

const { PrismaClient } = require('@prisma/client');

// Cache the Prisma client across invocations (particularly important for
// serverless environments like Vercel functions) to avoid exhausting
// database connections. If `_prisma` is already set on the global object,
// reuse it; otherwise instantiate a new client and assign it.
const g = globalThis;
const prisma = g._prisma ?? new PrismaClient();
if (!g._prisma) g._prisma = prisma;

module.exports = async (req, res) => {
  // Only allow GET requests for the health check. Respond with 405 for
  // unsupported methods. Use JSON throughout to make consumption easy.
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let db = false;
  let dbError = null;

  try {
    // Attempt a basic query. Prisma will use the DATABASE_URL internally.
    // `$queryRaw` returns a Promise; if it resolves, connectivity is OK.
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch (err) {
    // Capture any error to include in the response. Don't throw so the
    // endpoint still returns a successful HTTP status.
    dbError = err.message || String(err);
  }

  // Construct the response JSON. Include `dbError` only when it exists.
  const response = {
    ok: true,
    db,
    message: db ? 'Health + DB OK' : 'Health endpoint working',
    ts: new Date().toISOString(),
  };
  if (dbError) {
    response.dbError = dbError;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json(response);
};

// Configure Vercel runtime settings. Ensure Node.js 20 runtime is used.
module.exports.config = { runtime: 'nodejs20' };