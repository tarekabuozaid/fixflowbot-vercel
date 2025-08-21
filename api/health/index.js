// CommonJS handler لفيرسل
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
  }
  
  try {
    await prisma.$queryRaw`SELECT 1`
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ 
      ok: true, 
      db: true, 
      message: 'Health endpoint working with DB',
      ts: new Date().toISOString() 
    }))
  } catch (e) {
    console.error('HEALTH_DB_ERROR', e)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ 
      ok: true, 
      db: false, 
      error: e.message,
      ts: new Date().toISOString() 
    }))
  }
}

module.exports.config = { runtime: 'nodejs20' }