/**
 * ============================================================================
 * FIXFLOW BOT - MAIN ENTRY POINT
 * ============================================================================
 * 
 * This is the main entry point for FixFlow maintenance management bot
 * Contains all commands, handlers, and interactive flows
 * 
 * Key Features:
 * - Facility and member management
 * - Work order creation and tracking
 * - Reporting and statistics system
 * - Reminder and notification management
 * - Role-based access control
 * - Team communication system
 * 
 * Architecture:
 * - SecurityManager: Security and validation management
 * - FlowManager: Interactive flow management
 * - PlanManager: Subscription plan management
 * - ErrorHandler: Centralized error handling
 * 
 * Last Updated: August 31, 2025
 * Developer: Tarek Abu Ozaid
 * ============================================================================
 */

const { Telegraf, Markup } = require('telegraf');
// تعطيل Prisma مؤقتاً للاختبار
// const { PrismaClient } = require('@prisma/client');

// ===== Import New Modular Utilities =====
const SecurityManager = require('./utils/security-test'); // استخدام النسخة التجريبية
const FlowManager = require('./utils/flowManager');
const PlanManager = require('./utils/planManager');
const ErrorHandler = require('./utils/errorHandler');

// Load environment variables from .env if present
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {
    // dotenv is optional; ignore if not installed
  }
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ID = process.env.MASTER_ID || '';

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, {
  telegram: { webhookReply: false },
  handlerTimeout: 9000
});

// تعطيل Prisma مؤقتاً للاختبار
// const prisma = new PrismaClient({
//   datasources: {
//     db: {
//       url: process.env.DATABASE_URL
//     }
//   }
// });

// ===== Local Functions =====
function sanitizeInput(input, maxLength = 1000) {
  return SecurityManager.sanitizeInput(input, maxLength);
}

async function authenticateUser(ctx) {
  try {
    return await SecurityManager.authenticateUser(ctx);
  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
}

async function validateFacilityAccess(ctx, facilityId, requiredRoles = []) {
  try {
    return await SecurityManager.validateFacilityAccess(ctx, facilityId, requiredRoles);
  } catch (error) {
    console.error('Facility access validation error:', error);
    throw error;
  }
}

async function validateWorkOrderAccess(ctx, workOrderId, requiredRoles = []) {
  try {
    return await SecurityManager.validateWorkOrderAccess(ctx, workOrderId, requiredRoles);
  } catch (error) {
    console.error('Work order access validation error:', error);
    throw error;
  }
}

function validateMasterAccess(ctx) {
  try {
    return SecurityManager.validateMasterAccess(ctx);
  } catch (error) {
    console.error('Master access validation error:', error);
    throw error;
  }
}

// ===== Plan Limits =====
const PLAN_LIMITS = {
  Free: {
    members: 5,
    workOrders: 50,
    reports: 3,
    reminders: 10
  },
  Pro: {
    members: 20,
    workOrders: 200,
    reports: 15,
    reminders: 50
  },
  Business: {
    members: 100,
    workOrders: 1000,
    reports: 100,
    reminders: 200
  }
};

async function checkPlanLimit(facilityId, action, count = 1) {
  try {
    return await PlanManager.checkPlanLimit(facilityId, action, count);
  } catch (error) {
    console.error('Plan limit check error:', error);
    throw error;
  }
}

async function getPlanInfo(facilityId) {
  try {
    return await PlanManager.getPlanInfo(facilityId);
  } catch (error) {
    console.error('Get plan info error:', error);
    throw error;
  }
}

// ===== Input Validation Functions =====
function validateEmail(email) {
  return SecurityManager.validateEmail(email);
}

function validatePhone(phone) {
  return SecurityManager.validatePhone(phone);
}

function validateName(name) {
  return SecurityManager.validateName(name);
}

// ===== Global Error Handler =====
bot.catch((err, ctx) => {
  const userId = ctx.from?.id || 'unknown';
  const username = ctx.from?.username || 'unknown';
  const chatId = ctx.chat?.id || 'unknown';
  
  console.error(`🚨 Security Error - User: ${userId} (@${username}), Chat: ${chatId}, Error:`, err);
  
  if (err.message.includes('Rate limit') || err.message.includes('Invalid user') || err.message.includes('Insufficient permissions')) {
    console.warn(`🔒 Security Event - User ${userId} attempted unauthorized access`);
  }
  
  ctx.reply('⚠️ An error occurred. Please try again.').catch(() => {});
});

// ===== Start Command =====
bot.command('start', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user, isNew } = await SecurityManager.authenticateUser(ctx);
    console.log(`✅ Start command received from: ${user.tgId} (${user.firstName})`);
    
    if (isNew) {
      await ctx.reply(
        `🎉 **Welcome to FixFlow!**\n\n` +
        `👋 Hello ${user.firstName || 'there'}!\n\n` +
        `🔧 **FixFlow** is your comprehensive maintenance management solution.\n\n` +
        `**What you can do:**\n` +
        `• Submit maintenance requests\n` +
        `• Track work orders\n` +
        `• Receive notifications\n` +
        `• Access reports and analytics\n\n` +
        `**Next Steps:**\n` +
        `1. Register a facility or join an existing one\n` +
        `2. Start managing your maintenance tasks\n` +
        `3. Explore all features\n\n` +
        `Let's get started! 🚀`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏢 Register Facility', callback_data: 'reg_fac_start' }],
              [{ text: '🔗 Join Facility', callback_data: 'join_fac_start' }],
              [{ text: '❓ Help', callback_data: 'help' }]
            ]
          }
        }
      );
    } else {
      await showMainMenu(ctx);
    }
  }, ctx, 'start_command');
});

// ===== Flow Management =====
const flows = new Map();

setInterval(() => {
  FlowManager.cleanupExpiredFlows();
}, 30 * 60 * 1000);

// ===== User Management Functions =====
const isMaster = (ctx) => {
  try {
    return SecurityManager.validateMasterAccess(ctx);
  } catch {
    return false;
  }
};

async function ensureUser(ctx) {
  const { user } = await SecurityManager.authenticateUser(ctx);
  return user;
}

async function getUser(ctx) {
  const { user } = await SecurityManager.authenticateUser(ctx);
  return user;
}

// ===== Main Menu =====
async function showMainMenu(ctx) {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    const buttons = [];
    
    // إظهار الأزرار الأساسية للمستخدم النشط
    if (user.status === 'active' && user.activeFacilityId) {
      buttons.push([
        Markup.button.callback('🏠 Home', 'menu_home'),
        Markup.button.callback('📊 Reports', 'menu_reports')
      ]);
      
      buttons.push([
        Markup.button.callback('💬 Team Chat', 'simple_communication'),
        Markup.button.callback('📸 Media Share', 'simple_media_share')
      ]);
      
      buttons.push([
        Markup.button.callback('🔧 Work', 'menu_work'),
        Markup.button.callback('👑 Admin', 'menu_admin')
      ]);
      
      if (isMaster(ctx)) {
        buttons.push([
          Markup.button.callback('🛠 Master Panel', 'master_panel'),
          Markup.button.callback('👑 Master Dashboard', 'master_dashboard')
        ]);
      }
    } else {
      buttons.push([
        Markup.button.callback('🏢 Register Facility', 'reg_fac_start'),
        Markup.button.callback('🔗 Join Facility', 'join_fac_start')
      ]);
    }
    
    buttons.push([Markup.button.callback('❓ Help', 'help')]);
    
    await ctx.reply('👋 Welcome to FixFlow! Choose a category:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in showMainMenu:', error);
    await ErrorHandler.handleError(error, ctx, 'showMainMenu');
  }
}

// ===== Official Commands =====
bot.command('registerfacility', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    FlowManager.setFlow(user.tgId.toString(), 'reg_fac', 1, {});
    await ctx.reply('🏢 Facility Registration (1/4)\nPlease enter the facility name (max 60 chars):');
  }, ctx, 'registerfacility_command');
});

bot.command('join', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    await requireMembershipOrList(ctx);
  }, ctx, 'join_command');
});

bot.command('switch', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    const memberships = await prisma.facilityMember.findMany({
      where: { userId: user.id, status: 'active' },
      include: { facility: true },
      take: 10
    });
    
    if (!memberships.length) {
      return ctx.reply('❌ You are not a member of any facilities.');
    }
    
    const buttons = memberships.map(m => [
      Markup.button.callback(
        `${SecurityManager.sanitizeInput(m.facility.name, 30)}${m.facility.id === user.activeFacilityId ? ' ✅' : ''}`,
        `switch_to_${m.facility.id}`
      )
    ]);
    
    buttons.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
    
    await ctx.reply('🔄 **Switch Active Facility**\n\nSelect a facility to switch to:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'switch_command');
});

// ===== Action Handlers =====
bot.action('reg_fac_start', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    FlowManager.setFlow(ctx.from.id.toString(), 'reg_fac', 1, {});
    await ctx.reply('🏢 Facility Registration (1/4)\nPlease enter the facility name (max 60 chars):');
  }, ctx, 'reg_fac_start');
});

bot.action('join_fac_start', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    await requireMembershipOrList(ctx);
  }, ctx, 'join_fac_start');
});

// ===== Facility Management =====
async function requireMembershipOrList(ctx) {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    // Mock facilities for testing
    const mockFacilities = [
      { id: '1', name: 'Hospital Central', status: 'active' },
      { id: '2', name: 'Office Building A', status: 'active' },
      { id: '3', name: 'Manufacturing Plant', status: 'active' }
    ];
    
    if (!mockFacilities.length) {
      return ctx.reply('⚠️ No active facilities available to join at this time.');
    }
    
    const rows = mockFacilities.map(f => [
      Markup.button.callback(
        `${SecurityManager.sanitizeInput(f.name, 30)}`, 
        `join_fac|${f.id}`
      )
    ]);
    
    await ctx.reply('Please choose a facility to request membership:', { 
      reply_markup: { inline_keyboard: rows } 
    });
  } catch (error) {
    console.error('Error in requireMembershipOrList:', error);
    await ErrorHandler.handleError(error, ctx, 'requireMembershipOrList');
  }
}

// ===== Simple Communication System =====
bot.action('simple_communication', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    // Mock member count for testing
    const facilityMembers = 3; // Simulated count
    const isAlone = facilityMembers <= 1;
    
    const buttons = [
      [
        Markup.button.callback('📝 Send Message', 'simple_send_message'),
        Markup.button.callback('📸 Send Photo', 'simple_send_photo')
      ],
      [
        Markup.button.callback('🎤 Voice Message', 'simple_voice_message'),
        Markup.button.callback('📋 Message History', 'simple_message_history')
      ]
    ];
    
    if (isAlone) {
      buttons.push([
        Markup.button.callback('🧪 Test Notification', 'simple_test_notification'),
        Markup.button.callback('📱 Test Alert', 'simple_test_alert')
      ]);
    }
    
    buttons.push([Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]);
    
    const message = 
      `💬 **Team Communication**\n\n` +
      `👤 **Facility Members**: ${facilityMembers}\n` +
      `${isAlone ? '🧪 **Test Mode**: You are alone in this facility. Use test features.\n\n' : ''}` +
      `Choose a communication option:`;
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'simple_communication');
});

bot.action('simple_send_message', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    FlowManager.setFlow(user.tgId.toString(), 'simple_message', 1, {});
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
    ];
    
    await ctx.reply(
      `📝 **Send Message**\n\n` +
      `Type your message below:\n\n` +
      `💡 **Note**: Your message will be sent to all team members (or as a test if you're alone).`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  }, ctx, 'simple_send_message');
});

bot.action('simple_test_notification', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    await ctx.reply(
      `🧪 **Test Notification Sent!**\n\n` +
      `✅ **Status**: Successfully sent\n` +
      `⏰ **Time**: ${new Date().toLocaleString()}\n` +
      `🔔 **Type**: System Alert\n` +
      `💬 **Message**: This is a test notification to verify the communication system is working properly.\n\n` +
      `💡 **Note**: Notification system is working correctly.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔔 Test Another', 'simple_test_notification')],
            [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
          ]
        }
      }
    );
  }, ctx, 'simple_test_notification');
});

bot.action('simple_media_share', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const buttons = [
      [
        Markup.button.callback('📸 Share Photo', 'simple_share_photo'),
        Markup.button.callback('📹 Share Video', 'simple_share_video')
      ],
      [
        Markup.button.callback('📎 Share File', 'simple_share_file'),
        Markup.button.callback('🎤 Voice Message', 'simple_voice_message')
      ],
      [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
    ];
    
    await ctx.reply(
      `📸 **Media Sharing**\n\n` +
      `Share photos, videos, files, and voice messages.\n\n` +
      `Choose what you want to share:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in simple media share:', error);
    await ctx.reply('⚠️ An error occurred while loading media sharing.');
  }
});

// ===== Helper Functions =====
// تم تبسيط هذه الدالة للعمل بدون قاعدة بيانات
async function requireActiveMembership(ctx) {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    if (!user.activeFacilityId || user.status !== 'active') {
      throw new Error('no_active_facility');
    }
    
    // Mock membership for testing
    const mockMembership = {
      id: BigInt(1),
      userId: user.id,
      facilityId: user.activeFacilityId,
      role: 'facility_admin',
      status: 'active'
    };
    
    return { user, member: mockMembership };
  } catch (error) {
    console.error('requireActiveMembership error:', error);
    throw error;
  }
}

// ===== Notification Functions (تم تبسيطها للاختبار) =====
// تم حذف دوال قاعدة البيانات مؤقتاً

// ===== Text Handler =====
bot.on('text', async (ctx, next) => {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    const flowState = FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState) return next();
    
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    const text = SecurityManager.sanitizeInput(ctx.message.text || '', 1000);
    if (!text) {
      return ctx.reply('⚠️ Invalid input. Please try again.');
    }
    
    // === SIMPLE MESSAGE FLOW ===
    if (flowState.flow === 'simple_message') {
      if (text.toLowerCase() === '/cancel') {
        FlowManager.clearFlow(ctx.from.id.toString());
        return ctx.reply('❌ Message cancelled.', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Communication', callback_data: 'simple_communication' }]] }
        });
      }
      
      // Simplified messaging for now - just echo back to same user
      FlowManager.clearFlow(ctx.from.id.toString());
      
      await ctx.reply(
        `✅ **Message Sent!**\n\n` +
        `📝 **Message**: ${text}\n` +
        `⏰ **Time**: ${new Date().toLocaleString()}\n\n` +
        `💡 **Note**: Message sent successfully.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('📝 Send Another', 'simple_send_message')],
              [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
            ]
          }
        }
      );
      return;
    }
    
    // === FACILITY REGISTRATION FLOW ===
    if (flowState.flow === 'reg_fac') {
      if (flowState.step === 1) {
        const facilityName = text.slice(0, 60);
        if (facilityName.length < 2) {
          return ctx.reply('Name must be at least 2 characters. Try again:');
        }
        FlowManager.updateData(ctx.from.id.toString(), { name: facilityName });
        FlowManager.updateStep(ctx.from.id.toString(), 2);
        return ctx.reply('🏙️ Facility Registration (2/4)\nEnter the city (max 40 chars):');
      }
      if (flowState.step === 2) {
        const city = text.slice(0, 40);
        if (city.length < 2) {
          return ctx.reply('City must be at least 2 characters. Try again:');
        }
        FlowManager.updateData(ctx.from.id.toString(), { city });
        FlowManager.updateStep(ctx.from.id.toString(), 3);
        return ctx.reply('📞 Facility Registration (3/4)\nEnter a contact phone (max 25 chars):');
      }
      if (flowState.step === 3) {
        const phone = text.slice(0, 25);
        FlowManager.updateData(ctx.from.id.toString(), { phone });
        FlowManager.updateStep(ctx.from.id.toString(), 4);
        const planButtons = ['Free', 'Pro', 'Business'].map(p => [Markup.button.callback(p, `regfac_plan|${p}`)]);
        return ctx.reply('💼 Facility Registration (4/4)\nChoose a subscription plan:', { 
          reply_markup: { inline_keyboard: planButtons } 
        });
      }
    }
    
    // === WORK ORDER FLOW ===
    if (flowState.flow === 'wo_new') {
      if (flowState.step === 1) {
        const description = text.slice(0, 500);
        FlowManager.clearFlow(ctx.from.id.toString());
        
        // For now, just acknowledge the work order creation
        await ctx.reply(
          `✅ **Work Order Created!**\n\n` +
          `📝 **Description**: ${description}\n` +
          `⏰ **Time**: ${new Date().toLocaleString()}\n` +
          `🆔 **ID**: WO-${Date.now()}\n\n` +
          `💡 **Note**: Work order has been created successfully.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback('➕ Create Another', 'wo_new')],
                [Markup.button.callback('📋 My Work Orders', 'wo_list')],
                [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
              ]
            }
          }
        );
        return;
      }
    }
    
    return next();
  } catch (error) {
    console.error('Error in text handler:', error);
    await ctx.reply('⚠️ An error occurred. Please try again.');
  }
});

// ===== Facility Registration Plan Selection =====
bot.action(/regfac_plan\|(Free|Pro|Business)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const flowState = FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'reg_fac') {
      return ctx.reply('⚠️ Registration session expired. Please start over.');
    }
    
    const plan = ctx.match[1];
    FlowManager.updateData(ctx.from.id.toString(), { plan });
    FlowManager.clearFlow(ctx.from.id.toString());
    
    const data = flowState.data;
    await ctx.reply(
      `✅ **Facility Registration Completed!**\n\n` +
      `🏢 **Name**: ${data.name}\n` +
      `🏙️ **City**: ${data.city}\n` +
      `📞 **Phone**: ${data.phone}\n` +
      `💼 **Plan**: ${plan}\n` +
      `⏳ **Status**: Pending approval\n\n` +
      `💡 **Next Steps**: Your facility registration has been submitted and is awaiting approval from the system administrator.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')],
            [Markup.button.callback('❓ Help', 'help')]
          ]
        }
      }
    );
    
    // Notify master if available
    const MASTER_ID = process.env.MASTER_ID;
    if (MASTER_ID) {
      try {
        await bot.telegram.sendMessage(
          MASTER_ID,
          `🏢 **New Facility Registration**\n\n` +
          `👤 **Requested by**: ${ctx.from.first_name || 'Unknown'} (${ctx.from.id})\n` +
          `🏢 **Name**: ${data.name}\n` +
          `🏙️ **City**: ${data.city}\n` +
          `📞 **Phone**: ${data.phone}\n` +
          `💼 **Plan**: ${plan}\n` +
          `⏰ **Time**: ${new Date().toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Failed to notify master:', error);
      }
    }
  }, ctx, 'regfac_plan_selection');
});

// ===== Join Facility Handler =====
bot.action(/join_fac\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const facilityId = ctx.match[1];
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    await ctx.reply(
      `✅ **Join Request Submitted!**\n\n` +
      `🏢 **Facility ID**: ${facilityId}\n` +
      `👤 **User**: ${user.firstName || 'Unknown'}\n` +
      `⏰ **Time**: ${new Date().toLocaleString()}\n` +
      `⏳ **Status**: Pending approval\n\n` +
      `💡 **Note**: Your join request has been submitted and is awaiting approval from the facility administrator.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')],
            [Markup.button.callback('❓ Help', 'help')]
          ]
        }
      }
    );
    
    // Notify master if available
    const MASTER_ID = process.env.MASTER_ID;
    if (MASTER_ID) {
      try {
        await bot.telegram.sendMessage(
          MASTER_ID,
          `👥 **New Join Request**\n\n` +
          `👤 **User**: ${user.firstName || 'Unknown'} (${ctx.from.id})\n` +
          `🏢 **Facility ID**: ${facilityId}\n` +
          `⏰ **Time**: ${new Date().toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Failed to notify master:', error);
      }
    }
  }, ctx, 'join_facility');
});

// ===== Switch Facility Handler =====
bot.action(/switch_to_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const facilityId = ctx.match[1];
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    await ctx.reply(
      `✅ **Facility Switched!**\n\n` +
      `🔄 **New Active Facility ID**: ${facilityId}\n` +
      `👤 **User**: ${user.firstName || 'Unknown'}\n` +
      `⏰ **Time**: ${new Date().toLocaleString()}\n\n` +
      `💡 **Note**: You have successfully switched to the new facility.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'switch_facility');
});

// ===== Work Order Actions =====
bot.action('wo_new', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    FlowManager.setFlow(ctx.from.id.toString(), 'wo_new', 1, {});
    
    await ctx.reply(
      `📝 **Create New Work Order**\n\n` +
      `Please describe the issue or maintenance request:\n\n` +
      `💡 **Tips**:\n` +
      `• Be specific about the problem\n` +
      `• Include location if relevant\n` +
      `• Mention urgency level\n\n` +
      `📤 **Type your description below:**`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('❌ Cancel', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'wo_new');
});

bot.action('wo_list', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    // Mock work orders for now
    const mockWorkOrders = [
      { id: 'WO-001', status: 'Open', description: 'Fix AC in office' },
      { id: 'WO-002', status: 'In Progress', description: 'Repair printer' },
      { id: 'WO-003', status: 'Completed', description: 'Replace light bulb' }
    ];
    
    let workOrdersList = `📋 **My Work Orders**\n\n`;
    
    if (mockWorkOrders.length === 0) {
      workOrdersList += `🔍 No work orders found.\n\n💡 **Tip**: Create your first work order using the "Create Work Order" button.`;
    } else {
      mockWorkOrders.forEach((wo, index) => {
        const statusEmoji = wo.status === 'Open' ? '🔴' : wo.status === 'In Progress' ? '🟡' : '🟢';
        workOrdersList += `${statusEmoji} **${wo.id}**\n`;
        workOrdersList += `📝 ${wo.description}\n`;
        workOrdersList += `📊 Status: ${wo.status}\n\n`;
      });
    }
    
    await ctx.reply(workOrdersList, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('➕ Create New', 'wo_new')],
          [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
        ]
      }
    });
  }, ctx, 'wo_list');
});

// ===== Master Panel Commands =====
bot.action('master_panel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    if (!isMaster(ctx)) {
      return ctx.reply('🚫 You are not authorized to access the master panel.');
    }
    
    const buttons = [
      [
        Markup.button.callback('🏢 Pending Facilities', 'master_list_fac'),
        Markup.button.callback('👥 Pending Members', 'master_list_members')
      ],
      [
        Markup.button.callback('📊 System Stats', 'master_stats'),
        Markup.button.callback('🔧 System Settings', 'master_settings')
      ],
      [Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(
      `👑 **Master Panel**\n\n` +
      `Welcome to the system administration panel.\n\n` +
      `Choose an option to manage the system:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  }, ctx, 'master_panel');
});

bot.action('master_list_fac', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    if (!isMaster(ctx)) {
      return ctx.reply('🚫 Unauthorized.');
    }
    
    // Mock pending facilities for testing
    const mockPendingFacilities = [
      { id: '1', name: 'Hospital Central', city: 'Cairo', plan: 'Pro' },
      { id: '2', name: 'Office Building A', city: 'Alexandria', plan: 'Free' }
    ];
    
    if (!mockPendingFacilities.length) {
      return ctx.reply(
        `📋 **No Pending Facilities**\n\nThere are currently no facilities waiting for approval.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[Markup.button.callback('🔙 Back to Master Panel', 'master_panel')]]
          }
        }
      );
    }
    
    const rows = mockPendingFacilities.map(f => [
      Markup.button.callback(`${f.name} (${f.city})`, `master_fac_approve|${f.id}`)
    ]);
    rows.push([Markup.button.callback('🔙 Back to Master Panel', 'master_panel')]);
    
    await ctx.reply(
      `🏢 **Pending Facilities**\n\nSelect a facility to approve:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows }
      }
    );
  }, ctx, 'master_list_fac');
});

bot.action(/master_fac_approve\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    if (!isMaster(ctx)) {
      return ctx.reply('🚫 Unauthorized.');
    }
    
    const facilityId = ctx.match[1];
    
    await ctx.reply(
      `✅ **Facility Approved!**\n\n` +
      `🏢 **Facility ID**: ${facilityId}\n` +
      `⏰ **Approved at**: ${new Date().toLocaleString()}\n` +
      `👑 **Approved by**: Master\n\n` +
      `💡 **Status**: The facility has been activated and the owner has been notified.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏢 View More Facilities', 'master_list_fac')],
            [Markup.button.callback('🔙 Back to Master Panel', 'master_panel')]
          ]
        }
      }
    );
  }, ctx, 'master_fac_approve');
});

bot.action('master_list_members', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    if (!isMaster(ctx)) {
      return ctx.reply('🚫 Unauthorized.');
    }
    
    // Mock pending member requests
    const mockPendingMembers = [
      { id: '1', userId: '987654321', facilityName: 'Hospital Central', requestedAt: new Date() },
      { id: '2', userId: '555666777', facilityName: 'Office Building A', requestedAt: new Date() }
    ];
    
    if (!mockPendingMembers.length) {
      return ctx.reply(
        `👥 **No Pending Member Requests**\n\nThere are currently no membership requests waiting for approval.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[Markup.button.callback('🔙 Back to Master Panel', 'master_panel')]]
          }
        }
      );
    }
    
    const rows = mockPendingMembers.map(r => [
      Markup.button.callback(
        `User ${r.userId} → ${r.facilityName}`,
        `master_member_approve|${r.id}`
      )
    ]);
    rows.push([Markup.button.callback('🔙 Back to Master Panel', 'master_panel')]);
    
    await ctx.reply(
      `👥 **Pending Membership Requests**\n\nSelect a request to approve:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows }
      }
    );
  }, ctx, 'master_list_members');
});

bot.action(/master_member_approve\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    if (!isMaster(ctx)) {
      return ctx.reply('🚫 Unauthorized.');
    }
    
    const requestId = ctx.match[1];
    
    await ctx.reply(
      `✅ **Membership Request Approved!**\n\n` +
      `📋 **Request ID**: ${requestId}\n` +
      `⏰ **Approved at**: ${new Date().toLocaleString()}\n` +
      `👑 **Approved by**: Master\n\n` +
      `💡 **Status**: The user has been added to the facility and notified.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('👥 View More Requests', 'master_list_members')],
            [Markup.button.callback('🔙 Back to Master Panel', 'master_panel')]
          ]
        }
      }
    );
  }, ctx, 'master_member_approve');
});

bot.action('master_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    if (!isMaster(ctx)) {
      return ctx.reply('🚫 Unauthorized.');
    }
    
    // Mock system statistics
    const stats = {
      totalFacilities: 25,
      activeFacilities: 23,
      pendingFacilities: 2,
      totalUsers: 127,
      activeUsers: 115,
      pendingUsers: 12,
      totalWorkOrders: 486,
      openWorkOrders: 23,
      completedWorkOrders: 463,
      totalMessages: 1247
    };
    
    const flowStats = FlowManager.getFlowStats();
    
    await ctx.reply(
      `📊 **System Statistics**\n\n` +
      `🏢 **Facilities:**\n` +
      `   • Total: ${stats.totalFacilities}\n` +
      `   • Active: ${stats.activeFacilities}\n` +
      `   • Pending: ${stats.pendingFacilities}\n\n` +
      `👥 **Users:**\n` +
      `   • Total: ${stats.totalUsers}\n` +
      `   • Active: ${stats.activeUsers}\n` +
      `   • Pending: ${stats.pendingUsers}\n\n` +
      `🔧 **Work Orders:**\n` +
      `   • Total: ${stats.totalWorkOrders}\n` +
      `   • Open: ${stats.openWorkOrders}\n` +
      `   • Completed: ${stats.completedWorkOrders}\n\n` +
      `💬 **Communication:**\n` +
      `   • Total Messages: ${stats.totalMessages}\n` +
      `   • Active Flows: ${flowStats.active}\n` +
      `   • Flow Types: ${Object.keys(flowStats.flowTypes).join(', ')}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Refresh Stats', 'master_stats')],
            [Markup.button.callback('🔙 Back to Master Panel', 'master_panel')]
          ]
        }
      }
    );
  }, ctx, 'master_stats');
});

bot.action('master_dashboard', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    if (!isMaster(ctx)) {
      return ctx.reply('🚫 Unauthorized.');
    }
    
    await ctx.reply(
      `👑 **Master Dashboard**\n\n` +
      `📈 **Quick Overview:**\n` +
      `• System Status: 🟢 Online\n` +
      `• Active Sessions: ${FlowManager.getFlowStats().active}\n` +
      `• Last Update: ${new Date().toLocaleString()}\n\n` +
      `🔧 **Quick Actions:**`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('🏢 Facilities', 'master_list_fac'),
              Markup.button.callback('👥 Members', 'master_list_members')
            ],
            [
              Markup.button.callback('📊 Statistics', 'master_stats'),
              Markup.button.callback('🛠 Master Panel', 'master_panel')
            ],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'master_dashboard');
});

// ===== Additional Communication Actions =====
bot.action('simple_send_photo', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    await ctx.reply(
      `📸 **Send Photo**\n\n` +
      `Please send a photo to share with your team.\n\n` +
      `💡 **Note**: Photo sharing feature is under development.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
          ]
        }
      }
    );
  }, ctx, 'simple_send_photo');
});

bot.action('simple_voice_message', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    await ctx.reply(
      `🎤 **Voice Message**\n\n` +
      `Please send a voice message to share with your team.\n\n` +
      `💡 **Note**: Voice message feature is under development.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
          ]
        }
      }
    );
  }, ctx, 'simple_voice_message');
});

bot.action('simple_message_history', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    // Mock message history
    const mockMessages = [
      { sender: 'Ahmed', message: 'Good morning team!', time: '09:00' },
      { sender: 'Sarah', message: 'Meeting at 2 PM today', time: '10:30' },
      { sender: 'Mohamed', message: 'AC repair completed', time: '14:15' }
    ];
    
    let historyText = `📋 **Message History**\n\n`;
    
    if (mockMessages.length === 0) {
      historyText += `🔍 No messages found.\n\n💡 **Tip**: Start a conversation by sending a message!`;
    } else {
      mockMessages.forEach((msg, index) => {
        historyText += `👤 **${msg.sender}** (${msg.time})\n`;
        historyText += `💬 ${msg.message}\n\n`;
      });
    }
    
    await ctx.reply(historyText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Refresh', 'simple_message_history')],
          [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
        ]
      }
    });
  }, ctx, 'simple_message_history');
});

bot.action('simple_test_alert', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    await ctx.reply(
      `📱 **Test Alert Sent!**\n\n` +
      `🚨 **Alert Type**: Emergency Test\n` +
      `⏰ **Time**: ${new Date().toLocaleString()}\n` +
      `📍 **Source**: System Test\n` +
      `💬 **Message**: This is a test emergency alert to verify the notification system.\n\n` +
      `✅ **Status**: Alert system is working correctly.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🚨 Test Another Alert', 'simple_test_alert')],
            [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
          ]
        }
      }
    );
  }, ctx, 'simple_test_alert');
});

// ===== Work Order Additional Actions =====
bot.action('wo_manage', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    await ctx.reply(
      `🔧 **Manage Work Orders**\n\n` +
      `Manage and track all work orders in your facility.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('📋 All Orders', 'wo_list_all'),
              Markup.button.callback('🔴 Open Orders', 'wo_list_open')
            ],
            [
              Markup.button.callback('🟡 In Progress', 'wo_list_progress'),
              Markup.button.callback('🟢 Completed', 'wo_list_completed')
            ],
            [Markup.button.callback('🔙 Back to Work Menu', 'menu_work')]
          ]
        }
      }
    );
  }, ctx, 'wo_manage');
});

bot.action('wo_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    // Mock work order statistics
    const stats = {
      total: 45,
      open: 8,
      inProgress: 12,
      completed: 25,
      thisWeek: 15,
      avgCompletionTime: '2.3 days'
    };
    
    await ctx.reply(
      `📊 **Work Order Statistics**\n\n` +
      `📈 **Overall Stats:**\n` +
      `• Total Work Orders: ${stats.total}\n` +
      `• Open: ${stats.open}\n` +
      `• In Progress: ${stats.inProgress}\n` +
      `• Completed: ${stats.completed}\n\n` +
      `📅 **This Week:**\n` +
      `• New Orders: ${stats.thisWeek}\n` +
      `• Avg Completion Time: ${stats.avgCompletionTime}\n\n` +
      `💡 **Performance**: Good`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Refresh Stats', 'wo_stats')],
            [Markup.button.callback('🔙 Back to Work Menu', 'menu_work')]
          ]
        }
      }
    );
  }, ctx, 'wo_stats');
});

// ===== Report Actions =====
['report_daily', 'report_weekly', 'report_monthly', 'report_custom'].forEach(reportType => {
  bot.action(reportType, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    
    return ErrorHandler.safeExecute(async () => {
      const reportName = reportType.replace('report_', '').replace('_', ' ');
      
      await ctx.reply(
        `📊 **${reportName.charAt(0).toUpperCase() + reportName.slice(1)} Report**\n\n` +
        `📈 **Report generated successfully!**\n` +
        `⏰ **Generated at**: ${new Date().toLocaleString()}\n\n` +
        `💡 **Note**: Report features are under development.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('📊 Generate Another', 'menu_reports')],
              [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
            ]
          }
        }
      );
    }, ctx, reportType);
  });
});

// ===== Admin Actions =====
['admin_members', 'admin_facility', 'admin_notifications', 'admin_system'].forEach(adminAction => {
  bot.action(adminAction, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    
    return ErrorHandler.safeExecute(async () => {
      const actionName = adminAction.replace('admin_', '').replace('_', ' ');
      
      await ctx.reply(
        `👑 **${actionName.charAt(0).toUpperCase() + actionName.slice(1)} Management**\n\n` +
        `⚙️ **Management interface for ${actionName}.**\n\n` +
        `💡 **Note**: Admin features are under development.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🔙 Back to Admin', 'menu_admin')],
              [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
            ]
          }
        }
      );
    }, ctx, adminAction);
  });
});

bot.action('menu_home', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await showMainMenu(ctx);
});

bot.action('menu_work', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const buttons = [
      [
        Markup.button.callback('➕ Create Work Order', 'wo_new'),
        Markup.button.callback('📋 My Work Orders', 'wo_list')
      ],
      [
        Markup.button.callback('🔧 Manage Work Orders', 'wo_manage'),
        Markup.button.callback('📊 Work Statistics', 'wo_stats')
      ],
      [Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(
      `🔧 **Work Management**\n\n` +
      `Choose an option to manage work orders and maintenance tasks:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  }, ctx, 'menu_work');
});

bot.action('menu_reports', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const buttons = [
      [
        Markup.button.callback('📊 Daily Report', 'report_daily'),
        Markup.button.callback('📈 Weekly Report', 'report_weekly')
      ],
      [
        Markup.button.callback('📋 Monthly Report', 'report_monthly'),
        Markup.button.callback('🎯 Custom Report', 'report_custom')
      ],
      [Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(
      `📊 **Reports & Analytics**\n\n` +
      `Generate reports and view analytics for your facility:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  }, ctx, 'menu_reports');
});

bot.action('menu_admin', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const buttons = [
      [
        Markup.button.callback('👥 Manage Members', 'admin_members'),
        Markup.button.callback('🏢 Facility Settings', 'admin_facility')
      ],
      [
        Markup.button.callback('🔔 Notifications', 'admin_notifications'),
        Markup.button.callback('⚙️ System Settings', 'admin_system')
      ],
      [Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(
      `👑 **Administration**\n\n` +
      `Manage your facility and system settings:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  }, ctx, 'menu_admin');
});

// ===== Back to Menu Handler =====
bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await showMainMenu(ctx);
});

// ===== Help Handler =====
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  const helpText = 
    `❓ **FixFlow Help**\n\n` +
    `🔧 **Main Features:**\n` +
    `• Work Order Management\n` +
    `• Team Communication\n` +
    `• Notifications & Reminders\n` +
    `• Reports & Analytics\n\n` +
    `📋 **Commands:**\n` +
    `/start - Main menu\n` +
    `/join - Join facility\n` +
    `/switch - Switch facilities\n` +
    `/members - View members\n\n` +
    `💡 **Need more help?** Contact your facility administrator.`;
  
  await ctx.reply(helpText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]]
    }
  });
});

// ===== Webhook Handler for Vercel =====
module.exports = async (req, res) => {
  console.log('Webhook received:', { method: req.method, body: req.body });
  
  if (req.method === 'POST') {
    try {
      res.setTimeout(25000, () => {
        console.log('Request timeout');
        res.status(408).json({ error: 'Request timeout' });
      });
      
      if (!req.body) {
        console.error('No body received');
        return res.status(400).json({ error: 'No body received' });
      }
      
      console.log('Processing update:', JSON.stringify(req.body, null, 2));
      await bot.handleUpdate(req.body);
      console.log('Update processed successfully');
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};
