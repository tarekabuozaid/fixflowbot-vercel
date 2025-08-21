// CommonJS handler لفيرسل
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
  }
  
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ 
    ok: true, 
    db: false, 
    message: 'Health endpoint working',
    ts: new Date().toISOString() 
  }))
}

module.exports.config = { runtime: 'nodejs20' }
