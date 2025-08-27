const https = require('https');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;

if (!BOT_TOKEN || !PUBLIC_URL) {
  console.error('❌ Missing BOT_TOKEN or PUBLIC_URL in environment');
  process.exit(1);
}

function makeRequest(url, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path: url,
      method: data ? 'POST' : 'GET',
      headers: data ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      } : {}
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

async function setWebhook() {
  try {
    console.log('🔧 Setting up webhook...');
    console.log('📡 Bot Token:', BOT_TOKEN.substring(0, 20) + '...');
    console.log('🌐 Public URL:', PUBLIC_URL);
    
    const webhookUrl = `${PUBLIC_URL}/api/telegram`;
    console.log('🔗 Webhook URL:', webhookUrl);
    
    const webhookData = JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 1
    });
    
    const result = await makeRequest(`/bot${BOT_TOKEN}/setWebhook`, webhookData);
    
    if (result.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('📋 Result:', result);
    } else {
      console.error('❌ Failed to set webhook:', result);
    }
    
    // Get webhook info
    console.log('\n📊 Getting webhook info...');
    const info = await makeRequest(`/bot${BOT_TOKEN}/getWebhookInfo`);
    
    if (info.ok) {
      console.log('✅ Webhook info:', info.result);
    } else {
      console.error('❌ Failed to get webhook info:', info);
    }
    
  } catch (error) {
    console.error('❌ Error setting webhook:', error);
  }
}

setWebhook();
