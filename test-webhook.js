require('dotenv').config();
const { Telegraf } = require('telegraf');

async function testWebhook() {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  
  try {
    console.log('🔍 Getting webhook info...');
    const info = await bot.telegram.getWebhookInfo();
    console.log('Webhook Info:');
    console.log('- URL:', info.url);
    console.log('- Pending updates:', info.pending_update_count);
    console.log('- Last error:', info.last_error_message || 'None');
    
    if (info.pending_update_count > 0) {
      console.log('📥 Getting pending updates...');
      const updates = await bot.telegram.getUpdates();
      console.log('Pending updates:', updates.length);
      updates.forEach((update, i) => {
        console.log(`Update ${i + 1}:`, update.message?.text || 'No text');
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testWebhook();
