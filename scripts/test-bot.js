// scripts/test-bot.js
const https = require('https');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ Missing BOT_TOKEN in environment');
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

async function testBot() {
  try {
    console.log('🧪 Testing bot functionality...');
    console.log('📡 Bot Token:', BOT_TOKEN.substring(0, 20) + '...');
    
    // Test 1: Send /start command
    console.log('\n1️⃣ Testing /start command...');
    const startData = JSON.stringify({
      chat_id: "7103238318",
      text: "/start"
    });
    
    const startResult = await makeRequest(`/bot${BOT_TOKEN}/sendMessage`, startData);
    
    if (startResult.ok) {
      console.log('✅ /start command sent successfully');
      console.log('📋 Message ID:', startResult.result.message_id);
    } else {
      console.error('❌ Failed to send /start:', startResult);
    }
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Send regular message
    console.log('\n2️⃣ Testing regular message...');
    const messageData = JSON.stringify({
      chat_id: "7103238318",
      text: "Testing bot functionality"
    });
    
    const messageResult = await makeRequest(`/bot${BOT_TOKEN}/sendMessage`, messageData);
    
    if (messageResult.ok) {
      console.log('✅ Regular message sent successfully');
      console.log('📋 Message ID:', messageResult.result.message_id);
    } else {
      console.error('❌ Failed to send message:', messageResult);
    }
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 3: Send /help command
    console.log('\n3️⃣ Testing /help command...');
    const helpData = JSON.stringify({
      chat_id: "7103238318",
      text: "/help"
    });
    
    const helpResult = await makeRequest(`/bot${BOT_TOKEN}/sendMessage`, helpData);
    
    if (helpResult.ok) {
      console.log('✅ /help command sent successfully');
      console.log('📋 Message ID:', helpResult.result.message_id);
    } else {
      console.error('❌ Failed to send /help:', helpResult);
    }
    
    console.log('\n🎉 Bot testing completed!');
    console.log('📝 Check your Telegram chat to see if the bot responded.');
    
  } catch (error) {
    console.error('❌ Error testing bot:', error);
  }
}

testBot();
