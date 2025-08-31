'use strict';

const redact = ['BOT_TOKEN', 'DATABASE_URL', 'CRON_SECRET', 'MASTER_ID'];

function log(level, msg, meta = {}) {
  const safe = { ...meta };
  redact.forEach(k => { 
    if (safe[k]) safe[k] = '[REDACTED]'; 
  });
  
  console.log(JSON.stringify({ 
    ts: new Date().toISOString(), 
    level, 
    msg, 
    ...safe 
  }));
}

module.exports = { 
  log,
  info: (msg, meta) => log('INFO', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  debug: (msg, meta) => log('DEBUG', msg, meta)
};
