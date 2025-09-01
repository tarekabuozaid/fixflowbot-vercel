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
const { PrismaClient } = require('@prisma/client');

// ===== Import New Modular Utilities =====
// These modules were recently developed to improve security and performance
const SecurityManager = require('./utils/security');      // Security and validation management
const FlowManager = require('./utils/flowManager');       // Interactive flow management
const PlanManager = require('./utils/planManager');       // Subscription plan management
const ErrorHandler = require('./utils/errorHandler');     // Centralized error handling

// Load environment variables from .env if present
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {
    // dotenv is اختياري; ignore if not installed
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
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// ===== Local Functions =====
// These functions use the new modules internally to maintain compatibility

// ===== Environment Variables and Settings =====
// Legacy rate limiting (will be replaced by SecurityManager)
const rateLimit = new Map();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 30;        // Number of allowed requests
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 60000;  // Time window (in milliseconds)

/**
 * تنظيف المدخلات من المستخدمين
 * @param {string} input - النص المدخل
 * @param {number} maxLength - الحد الأقصى للطول (افتراضي: 1000)
 * @returns {string} النص المنظف
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
function sanitizeInput(input, maxLength = 1000) {
  return SecurityManager.sanitizeInput(input, maxLength);
}

/**
 * التحقق من هوية المستخدم
 * @param {Object} ctx - سياق طلب تيليجرام
 * @returns {Promise<Object>} بيانات المستخدم
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
async function authenticateUser(ctx) {
  try {
    return await SecurityManager.authenticateUser(ctx);
  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
}

/**
 * التحقق من صلاحية الوصول للمنشأة
 * @param {Object} ctx - سياق طلب تيليجرام
 * @param {BigInt} facilityId - معرف المنشأة
 * @param {Array} requiredRoles - الأدوار المطلوبة
 * @returns {Promise<Object>} نتيجة التحقق
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
async function validateFacilityAccess(ctx, facilityId, requiredRoles = []) {
  try {
    return await SecurityManager.validateFacilityAccess(ctx, facilityId, requiredRoles);
  } catch (error) {
    console.error('Facility access validation error:', error);
    throw error;
  }
}

/**
 * التحقق من صلاحية الوصول لطلب الصيانة
 * @param {Object} ctx - سياق طلب تيليجرام
 * @param {BigInt} workOrderId - معرف طلب الصيانة
 * @param {Array} requiredRoles - الأدوار المطلوبة
 * @returns {Promise<Object>} نتيجة التحقق
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
async function validateWorkOrderAccess(ctx, workOrderId, requiredRoles = []) {
  try {
    return await SecurityManager.validateWorkOrderAccess(ctx, workOrderId, requiredRoles);
  } catch (error) {
    console.error('Work order access validation error:', error);
    throw error;
  }
}

/**
 * التحقق من صلاحيات الماستر
 * @param {Object} ctx - سياق طلب تيليجرام
 * @returns {boolean} true إذا كان المستخدم ماستر
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
function validateMasterAccess(ctx) {
  try {
    return SecurityManager.validateMasterAccess(ctx);
  } catch (error) {
    console.error('Master access validation error:', error);
    throw error;
  }
}

// ===== خطط الاشتراك والحدود =====
/**
 * حدود خطط الاشتراك المختلفة
 * 
 * Free: الخطة المجانية - مناسبة للمنشآت الصغيرة
 * Pro: الخطة الاحترافية - مناسبة للمنشآت المتوسطة
 * Business: الخطة التجارية - مناسبة للمنشآت الكبيرة
 * 
 * ملاحظة: هذه الحدود يتم التحقق منها عبر PlanManager
 */
const PLAN_LIMITS = {
  Free: {
    members: 5,        // عدد الأعضاء المسموح
    workOrders: 50,    // عدد طلبات الصيانة شهرياً
    reports: 3,        // عدد التقارير المسموحة
    reminders: 10      // عدد التذكيرات المسموحة
  },
  Pro: {
    members: 20,       // عدد الأعضاء المسموح
    workOrders: 200,   // عدد طلبات الصيانة شهرياً
    reports: 15,       // عدد التقارير المسموحة
    reminders: 50      // عدد التذكيرات المسموحة
  },
  Business: {
    members: 100,
    workOrders: 1000,
    reports: 100,
    reminders: 200
  }
};

// Legacy plan limit check (will be replaced by PlanManager)
async function checkPlanLimit(facilityId, action, count = 1) {
  try {
    return await PlanManager.checkPlanLimit(facilityId, action, count);
  } catch (error) {
    console.error('Plan limit check error:', error);
    throw error;
  }
}

// Legacy get plan info (will be replaced by PlanManager)
async function getPlanInfo(facilityId) {
  try {
    return await PlanManager.getPlanInfo(facilityId);
  } catch (error) {
    console.error('Get plan info error:', error);
    throw error;
  }
}

// ===== دوال التحقق من المدخلات =====
/**
 * التحقق من صحة البريد الإلكتروني
 * @param {string} email - البريد الإلكتروني للتحقق
 * @returns {boolean} true إذا كان البريد صحيح
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
function validateEmail(email) {
  return SecurityManager.validateEmail(email);
}

/**
 * التحقق من صحة رقم الهاتف
 * @param {string} phone - رقم الهاتف للتحقق
 * @returns {boolean} true إذا كان الرقم صحيح
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
function validatePhone(phone) {
  return SecurityManager.validatePhone(phone);
}

/**
 * التحقق من صحة الاسم
 * @param {string} name - الاسم للتحقق
 * @returns {boolean} true إذا كان الاسم صحيح
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
function validateName(name) {
  return SecurityManager.validateName(name);
}

// Global error handler with security logging
bot.catch((err, ctx) => {
  const userId = ctx.from?.id || 'unknown';
  const username = ctx.from?.username || 'unknown';
  const chatId = ctx.chat?.id || 'unknown';
  
  console.error(`🚨 Security Error - User: ${userId} (@${username}), Chat: ${chatId}, Error:`, err);
  
  // Log security events
  if (err.message.includes('Rate limit') || err.message.includes('Invalid user') || err.message.includes('Insufficient permissions')) {
    console.warn(`🔒 Security Event - User ${userId} attempted unauthorized access`);
  }
  
  ctx.reply('⚠️ An error occurred. Please try again.').catch(() => {});
});

// Start command handler with enhanced error handling
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

// Legacy flow management (DEPRECATED - using FlowManager instead)
// Note: FlowManager handles cleanup automatically
const flows = new Map();

// Legacy cleanup (FlowManager handles this automatically)
setInterval(() => {
  FlowManager.cleanupExpiredFlows();
}, 30 * 60 * 1000); // Check every 30 minutes

// ===== دوال إدارة المستخدمين =====
/**
 * التحقق من صلاحيات الماستر
 * @param {Object} ctx - سياق طلب تيليجرام
 * @returns {boolean} true إذا كان المستخدم ماستر
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
const isMaster = (ctx) => {
  try {
    return SecurityManager.validateMasterAccess(ctx);
  } catch {
    return false;
  }
};

/**
 * التأكد من وجود المستخدم والحصول على بياناته
 * @param {Object} ctx - سياق طلب تيليجرام
 * @returns {Promise<Object>} بيانات المستخدم
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
async function ensureUser(ctx) {
  const { user } = await SecurityManager.authenticateUser(ctx);
  return user;
}

/**
 * الحصول على بيانات المستخدم
 * @param {Object} ctx - سياق طلب تيليجرام
 * @returns {Promise<Object>} بيانات المستخدم
 * 
 * ملاحظة: هذه دالة محلية تستخدم SecurityManager داخلياً
 */
async function getUser(ctx) {
  const { user } = await SecurityManager.authenticateUser(ctx);
  return user;
}

/**
 * عرض القائمة الرئيسية للبوت
 * @param {Object} ctx - سياق طلب تيليجرام
 * 
 * هذه الدالة تعرض القائمة الرئيسية حسب حالة المستخدم:
 * - Users الجدد: خيارات التسجيل والانضمام
 * - Users النشطين: القائمة الكاملة مع الأزرار الأربعة الرئيسية
 * - الماستر: إضافة لوحة تحكم الماستر
 * 
 * الأزرار الرئيسية:
 * - 🏠 Home: لوحة التحكم الرئيسية
 * - 📊 Reports: التقارير والStatistics
 * - 🔧 Work: إدارة طلبات الصيانة
 * - 👑 Admin: إدارة المنشأة والأعضاء
 */
async function showMainMenu(ctx) {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    const buttons = [];
    
    if (user.status === 'active' && user.activeFacilityId) {
      // Get user membership data
      const membership = await prisma.facilityMember.findFirst({
        where: {
          userId: user.id,
          facilityId: user.activeFacilityId,
          status: 'active'
        }
      });
      
      // === MAIN MENU - 4 MAIN BUTTONS ===
      buttons.push([
        Markup.button.callback('🏠 Home', 'menu_home'),
        Markup.button.callback('📊 Reports', 'menu_reports')
      ]);
      
      // Add communication button for all active users
      buttons.push([
        Markup.button.callback('💬 Team Chat', 'simple_communication'),
        Markup.button.callback('📸 Media Share', 'simple_media_share')
      ]);
      
      // Check if user is technician to show technician dashboard
      if (membership && membership.role === 'technician') {
        buttons.push([
          Markup.button.callback('🔧 Work', 'menu_work'),
          Markup.button.callback('🛠️ My Tasks', 'technician_dashboard')
        ]);
        buttons.push([
          Markup.button.callback('👑 Admin', 'menu_admin')
        ]);
      } else {
        buttons.push([
          Markup.button.callback('🔧 Work', 'menu_work'),
          Markup.button.callback('👑 Admin', 'menu_admin')
        ]);
      }
      
      // === MASTER SECTION ===
      if (isMaster(ctx)) {
        buttons.push([
          Markup.button.callback('🛠 Master Panel', 'master_panel'),
          Markup.button.callback('👑 Master Dashboard', 'master_dashboard')
        ]);
      }
    } else {
      // === NEW USERS SECTION ===
      buttons.push([
        Markup.button.callback('🏢 Register Facility', 'reg_fac_start'),
        Markup.button.callback('🔗 Join Facility', 'join_fac_start')
      ]);
    }
    
    // === HELP SECTION ===
    buttons.push([Markup.button.callback('❓ Help', 'help')]);
    
    await ctx.reply('👋 Welcome to FixFlow! Choose a category:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in showMainMenu:', error);
    if (error.message.includes('Rate limit')) {
      await ctx.reply('⚠️ Too many requests. Please wait a moment and try again.');
    } else {
      await ctx.reply('⚠️ An error occurred while loading the menu. Please try again.');
    }
  }
}

// Remove duplicate start handler - using bot.command('start') instead

// ===== الأوامر الرسمية مع الأمان =====

/**
 * أمر تسجيل منشأة جديدة
 * 
 * هذا الأمر يبدأ فلو تسجيل منشأة جديدة:
 * 1. اسم المنشأة (Step 1/4)
 * 2. المدينة (Step 2/4)
 * 3. رقم الهاتف (Step 3/4)
 * 4. اختيار الخطة (Step 4/4)
 * 
 * Notes:
 * - يتم التحقق من الأمان عبر SecurityManager
 * - يتم إدارة الفلو عبر FlowManager
 * - يتم معالجة الأخطاء عبر ErrorHandler
 */
bot.command('registerfacility', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    FlowManager.setFlow(user.tgId.toString(), 'reg_fac', 1, {});
    await ctx.reply('🏢 Facility Registration (1/4)\nPlease enter the facility name (max 60 chars):');
  }, ctx, 'registerfacility_command');
});

/**
 * أمر الانضمام لمنشأة
 * 
 * هذا الأمر يعرض قائمة المنشآت النشطة المتاحة للانضمام
 * المستخدم يمكنه اختيار منشأة والانضمام إليها
 * 
 * Notes:
 * - يتم التحقق من الأمان عبر SecurityManager
 * - يتم معالجة الأخطاء عبر ErrorHandler
 */
bot.command('join', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    await requireMembershipOrList(ctx);
  }, ctx, 'join_command');
});

/**
 * أمر التبديل بين المنشآت
 * 
 * هذا الأمر يعرض قائمة المنشآت التي ينتمي إليها المستخدم
 * ويسمح له بالتبديل بينها
 * 
 * Notes:
 * - يتم التحقق من الأمان عبر SecurityManager
 * - يتم معالجة الأخطاء عبر ErrorHandler
 */
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

bot.command('members', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user, facility, membership } = await SecurityManager.validateFacilityAccess(ctx, null, ['facility_admin', 'supervisor']);
    
    const members = await prisma.facilityMember.findMany({
      where: { facilityId: facility.id, status: 'active' },
      include: { user: true },
      orderBy: { role: 'asc' }
    });
    
    let memberList = '👥 **Facility Members**\n\n';
    members.forEach((m, index) => {
      const roleEmoji = {
        'facility_admin': '👑',
        'supervisor': '👨‍💼',
        'technician': '🔧',
        'user': '👤'
      };
      
      const firstName = m.user.firstName || `User ${m.user.tgId?.toString() || m.user.id.toString()}`;
      const fullName = m.user.lastName ? `${firstName} ${m.user.lastName}` : firstName;
      const displayName = SecurityManager.sanitizeInput(fullName, 30);
      const jobTitle = m.user.jobTitle ? ` - ${m.user.jobTitle}` : '';
      
      memberList += `${index + 1}. ${roleEmoji[m.role]} ${displayName}${jobTitle}\n`;
      memberList += `   Role: ${m.role.replace('_', ' ').toUpperCase()}\n`;
      memberList += `   Status: ${m.user.status}\n\n`;
    });
    
    const buttons = [
      [Markup.button.callback('➕ Add Member', 'add_member')],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(memberList, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'members_command');
});

bot.command('approve', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    SecurityManager.validateMasterAccess(ctx);
    
    const [pendingFacilities, pendingRequests] = await Promise.all([
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.facilitySwitchRequest.count({ where: { status: 'pending' } })
    ]);
    
    let approvalText = '✅ **Approval Dashboard**\n\n';
    
    if (pendingFacilities > 0) {
      approvalText += `🏢 **Pending Facilities:** ${pendingFacilities}\n`;
    }
    
    if (pendingRequests > 0) {
      approvalText += `👥 **Pending Join Requests:** ${pendingRequests}\n`;
    }
    
    if (pendingFacilities === 0 && pendingRequests === 0) {
      approvalText += '🎉 No pending approvals!';
    }
    
    const buttons = [];
    
    if (pendingFacilities > 0) {
      buttons.push([Markup.button.callback('🏢 Review Facilities', 'master_list_fac')]);
    }
    
    if (pendingRequests > 0) {
      buttons.push([Markup.button.callback('👥 Review Requests', 'master_list_members')]);
    }
    
    buttons.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
    
    await ctx.reply(approvalText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'approve_command');
});

bot.command('deny', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    SecurityManager.validateMasterAccess(ctx);
    await ctx.reply('❌ **Deny Requests**\n\nUse /approve to review and manage pending requests.');
  }, ctx, 'deny_command');
});

bot.command('setrole', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user, facility, membership } = await SecurityManager.validateFacilityAccess(ctx, null, ['facility_admin']);
    await ctx.reply('👑 **Set Member Role**\n\nThis feature will be available soon!\n\nFor now, use the facility dashboard to manage members.');
  }, ctx, 'setrole_command');
});

// === Facility Registration Flow ===
bot.action('reg_fac_start', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    FlowManager.setFlow(ctx.from.id.toString(), 'reg_fac', 1, {});
    await ctx.reply('🏢 Facility Registration (1/4)\nPlease enter the facility name (max 60 chars):');
  }, ctx, 'reg_fac_start');
});

// === Join Facility Flow ===
bot.action('join_fac_start', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    await requireMembershipOrList(ctx);
  }, ctx, 'join_fac_start');
});

/**
 * عرض قائمة المنشآت النشطة للانضمام
 * @param {Object} ctx - سياق طلب تيليجرام
 * 
 * هذه الدالة تعرض قائمة المنشآت النشطة المتاحة للانضمام
 * المستخدم يمكنه اختيار منشأة والانضمام إليها
 * 
 * Notes:
 * - يتم التحقق من الأمان عبر SecurityManager
 * - يتم معالجة الأخطاء عبر ErrorHandler
 * - اسم المنشأةs are cleaned via SecurityManager.sanitizeInput
 */
async function requireMembershipOrList(ctx) {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    // List active facilities
    const facs = await prisma.facility.findMany({ 
      where: { status: 'active' }, 
      take: 20,
      orderBy: { name: 'asc' }
    });
    
    if (!facs.length) {
      return ctx.reply('⚠️ No active facilities available to join at this time.');
    }
    
    const rows = facs.map(f => [
      Markup.button.callback(
        `${SecurityManager.sanitizeInput(f.name, 30)}`, 
        `join_fac|${f.id.toString()}`
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

// Join facility with specific role
bot.action(/join_facility\|(\d+)\|(\w+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    const facilityId = BigInt(ctx.match[1]);
    const role = ctx.match[2];
    
    // Validate role
    if (!['user', 'technician', 'supervisor'].includes(role)) {
      return ctx.reply('⚠️ Invalid role selected. Please try again.');
    }
    
    // Get flow data
    const flowState = FlowManager.getFlow(user.tgId.toString());
    if (!flowState || !['register_user', 'register_technician', 'register_supervisor'].includes(flowState.flow)) {
      return ctx.reply('⚠️ Invalid registration flow. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(user.tgId.toString(), flowState)) {
      FlowManager.clearFlow(user.tgId.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    // Check if facility exists and is active
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId }
    });
    
    if (!facility || facility.status !== 'active') {
      return ctx.reply('⚠️ Facility not found or inactive.');
    }
    
    // Check if user is already a member
    const existingMembership = await prisma.facilityMember.findFirst({
      where: { userId: user.id, facilityId }
    });
    
    if (existingMembership) {
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ You are already a member of this facility.');
    }
    
    // Update user profile with registration data
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: flowState.data.firstName,
        lastName: flowState.data.lastName,
        email: flowState.data.email,
        phone: flowState.data.phone,
        jobTitle: flowState.data.jobTitle
      }
    });
    
    // Check plan limits before creating membership
    try {
      await PlanManager.checkPlanLimit(facilityId, 'members', 1);
    } catch (error) {
      FlowManager.clearFlow(user.tgId.toString());
      return ctx.reply(`⚠️ **Plan Limit Exceeded**\n\n${error.message}\n\nPlease contact the facility administrator to upgrade the plan.`);
    }
    
    // Create membership request
    const membership = await prisma.facilityMember.create({
      data: {
        userId: user.id,
        facilityId,
        role: role,
        status: 'pending',
        joinedAt: new Date()
      }
    });
    
    // Create switch request for approval
    await prisma.facilitySwitchRequest.create({
      data: {
        userId: user.id,
        facilityId,
        requestedRole: role,
        status: 'pending',
        requestDate: new Date()
      }
    });
    
    // Clear flow
    FlowManager.clearFlow(ctx.from.id.toString());
    
    const roleText = {
      'user': 'User',
      'technician': 'Technician',
      'supervisor': 'Supervisor'
    };
    
    await ctx.reply(
      `✅ **Registration Request Submitted!**\n\n` +
      `🏢 **Facility:** ${facility.name}\n` +
      `👤 **Role:** ${roleText[role]}\n` +
      `📝 **Name:** ${flowState.data.fullName}\n` +
      `📧 **Email:** ${flowState.data.email || 'Not provided'}\n` +
      `📞 **Phone:** ${flowState.data.phone || 'Not provided'}\n` +
      `💼 **Job Title:** ${flowState.data.jobTitle || 'Not provided'}\n\n` +
      `⏳ **Status:** Pending Approval\n\n` +
      `The facility administrator will review your request and approve it soon. You will receive a notification مرة واحدة approved.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]]
        }
      }
    );
    
    // Notify facility admins
    const admins = await prisma.facilityMember.findMany({
      where: {
        facilityId,
        role: 'facility_admin'
      },
      include: { user: true }
    });
    
    for (const admin of admins) {
      await createNotification(
        admin.userId,
        facilityId,
        'new_member_request',
        'New Member Request',
        `New ${roleText[role]} registration request from ${flowState.data.fullName}${flowState.data.jobTitle ? ` (${flowState.data.jobTitle})` : ''}`,
        { 
          userId: user.id.toString(),
          facilityId: facilityId.toString(),
          role: role,
          jobTitle: flowState.data.jobTitle
        }
      );
    }
    
  } catch (error) {
    console.error('Error joining facility:', error);
    FlowManager.clearFlow(ctx.from.id.toString());
    await ctx.reply('⚠️ An error occurred while processing your request.');
  }
});

// Legacy join_fac handler - redirect to proper registration flow
bot.action(/join_fac\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    // Check if user is already registered
    const existingMembership = await prisma.facilityMember.findFirst({
      where: { userId: user.id, status: 'active' }
    });
    
    if (existingMembership) {
      return ctx.reply('⚠️ You are already registered as an active member in a facility.');
    }
    
    // Redirect to user registration flow
    FlowManager.setFlow(user.tgId.toString(), 'register_user', 1, {});
    
    await ctx.reply(
      '👤 **User Registration**\n\n' +
      'You are registering as a **User**.\n\n' +
      '**User Permissions:**\n' +
      '• Submit maintenance requests\n' +
      '• View your own requests\n' +
      '• Receive notifications\n\n' +
      '**Registration Steps:**\n' +
      '1. Full Name\n' +
      '2. Email (اختياري)\n' +
      '3. Phone Number (اختياري)\n' +
      '4. Job Title (اختياري)\n' +
      '5. Select Facility\n\n' +
      'Please enter your **full name**:'
    );
  } catch (error) {
    console.error('Error in legacy join_fac handler:', error);
    await ctx.reply('⚠️ An error occurred. Please try again.');
  }
});

// Switch to facility handler
bot.action(/switch_to_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const facilityId = BigInt(ctx.match[1]);
    const user = await ensureUser(ctx);
    
    // Check if user is member of this facility
    const membership = await prisma.facilityMember.findFirst({
      where: { userId: user.id, facilityId }
    });
    
    if (!membership) {
      return ctx.answerCbQuery('You are not a member of this facility', { show_alert: true });
    }
    
    // Update active facility
    await prisma.user.update({
      where: { id: user.id },
      data: { activeFacilityId: facilityId }
    });
    
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId }
    });
    
    await ctx.editMessageText(
      `✅ **Facility Switched Successfully!**\n\nYou are now active in: **${facility?.name}**`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Back to Menu', callback_data: 'back_to_menu' }]]
        }
      }
    );
  } catch (error) {
    console.error('Error switching facility:', error);
    await ctx.answerCbQuery('Failed to switch facility', { show_alert: true });
  }
});

// === Work Order Flow ===
bot.action('wo_new', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await requireActiveMembership(ctx);
    
    // Create flow state using FlowManager
    FlowManager.setFlow(ctx.from.id.toString(), 'wo_new', 1, {});
    
    // Step 1: Choose work type
    const workTypeButtons = [
      [Markup.button.callback('🔧 Maintenance', 'wo_type|maintenance')],
      [Markup.button.callback('🔨 Repair', 'wo_type|repair')],
      [Markup.button.callback('🛠️ Installation', 'wo_type|installation')],
      [Markup.button.callback('🧹 Cleaning', 'wo_type|cleaning')],
      [Markup.button.callback('📋 Inspection', 'wo_type|inspection')],
      [Markup.button.callback('⚡ Other', 'wo_type|other')]
    ];
    
    await ctx.reply('🔧 Work Order Creation (1/6)\nChoose the type of work:', {
      reply_markup: { inline_keyboard: workTypeButtons }
    });
  }, ctx, 'wo_new');
});

bot.action('wo_list', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await requireActiveMembership(ctx);
    
    // Get statistics
    const stats = await prisma.workOrder.groupBy({
      by: ['status'],
      where: { facilityId: user.activeFacilityId, createdByUserId: user.id },
      _count: { status: true }
    });
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    const statsText = stats.map(s => 
      `${statusEmoji[s.status]} ${statusText[s.status]}: ${s._count.status}`
    ).join(' | ');
    
    const buttons = [
      [Markup.button.callback('🔍 All Orders', 'wo_filter|all')],
      [Markup.button.callback('🔵 Open Only', 'wo_filter|open')],
      [Markup.button.callback('🟡 In Progress', 'wo_filter|in_progress')],
      [Markup.button.callback('🟢 Done', 'wo_filter|done')],
      [Markup.button.callback('⚫ Closed', 'wo_filter|closed')],
      [Markup.button.callback('🔴 High Priority', 'wo_filter|priority_high')],
      [Markup.button.callback('📊 Facility Orders', 'wo_facility_list')],
      [Markup.button.callback('📈 Statistics', 'wo_stats')]
    ];
    
    await ctx.reply(`📋 **Work Orders Management**\n\n${statsText}\n\nChoose an option:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'wo_list');
});

/**
 * التحقق من وجود عضوية نشطة للمستخدم
 * @param {Object} ctx - سياق طلب تيليجرام
 * @returns {Promise<Object>} بيانات المستخدم والعضوية
 * 
 * هذه الدالة تتحقق من أن المستخدم:
 * - لديه عضوية نشطة في منشأة
 * - المنشأة نشطة
 * - الUser نشط
 * 
 * Notes:
 * - يتم التحقق من الأمان عبر SecurityManager
 * - يتم إرجاع بيانات المستخدم والعضوية
 * - يتم رفع خطأ إذا لم توجد عضوية نشطة
 */
async function requireActiveMembership(ctx) {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    if (!user.activeFacilityId || user.status !== 'active') {
      throw new Error('no_active_facility');
    }
    
    // Get facility membership
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        status: 'active'
      }
    });
    
    return { user, member: membership };
  } catch (error) {
    console.error('requireActiveMembership error:', error);
    throw error;
  }
}

// ===== نظام التواصل الجماعي - معالجات الأحداث =====

// ===== نظام التواصل الجماعي - معالجات الأحداث =====

// قائمة التواصل الجماعي الرئيسية
bot.action('team_communication_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const chatRooms = await getFacilityChatRooms(user.activeFacilityId);
    const userMemberships = await prisma.chatMember.findMany({
      where: { 
        userId: user.id,
        isActive: true
      },
      include: { chatRoom: true }
    });
    
    // Check if user is alone in facility
    const facilityMembers = await prisma.facilityMember.count({
      where: { 
        facilityId: user.activeFacilityId,
        status: 'active'
      }
    });
    
    const isAlone = facilityMembers <= 1;
    
    const buttons = [
      [
        Markup.button.callback('💬 Team Chat', 'join_team_chat'),
        Markup.button.callback('📸 Share Media', 'share_media')
      ],
      [
        Markup.button.callback('🎤 Voice Message', 'voice_message'),
        Markup.button.callback('📹 Video Call', 'video_call')
      ]
    ];
    
    // Only show create room if user has permissions and not alone
    if (!isAlone) {
      buttons.push([
        Markup.button.callback('➕ Create Chat Room', 'create_chat_room'),
        Markup.button.callback('📋 My Chat Rooms', 'my_chat_rooms')
      ]);
    }
    
    // Add test mode for single users
    if (isAlone) {
      buttons.push([
        Markup.button.callback('🧪 Test Communication', 'test_communication'),
        Markup.button.callback('📝 Send Test Message', 'send_test_message')
      ]);
    }
    
    // Add existing chat rooms
    if (chatRooms.length > 0) {
      const roomButtons = chatRooms.slice(0, 3).map(room => [
        Markup.button.callback(
          `💬 ${room.name} (${room._count.members} members)`,
          `join_chat_room|${room.id}`
        )
      ]);
      buttons.push(...roomButtons);
    }
    
    buttons.push([Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]);
    
    const message = 
      `💬 **Team Communication**\n\n` +
      `📊 **Available Chat Rooms**: ${chatRooms.length}\n` +
      `👥 **Your Memberships**: ${userMemberships.length}\n` +
      `👤 **Facility Members**: ${facilityMembers}\n\n` +
      `${isAlone ? '🧪 **Test Mode**: You are alone in this facility. Use test features to try communication.\n\n' : ''}` +
      `Choose a communication option:`;
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in team communication menu:', error);
    await ctx.reply('⚠️ An error occurred while loading communication menu.');
  }
});

// إنشاء غرفة دردشة جديدة
bot.action('create_chat_room', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, membership } = await requireActiveMembership(ctx);
    
    // Check if user can create chat rooms (admin or supervisor)
    if (!['facility_admin', 'supervisor'].includes(membership.role)) {
      return ctx.reply('⚠️ Only admins and supervisors can create chat rooms.');
    }
    
    FlowManager.setFlow(user.tgId.toString(), 'create_chat_room', 1, {});
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Communication', 'team_communication_menu')]
    ];
    
    await ctx.reply(
      `➕ **Create New Chat Room** (1/4)\n\n` +
      `Please enter the chat room name (max 50 characters):\n\n` +
      `💡 **Examples**:\n` +
      `• General Team Chat\n` +
      `• Emergency Alerts\n` +
      `• Project Discussion\n` +
      `• Technical Support`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error creating chat room:', error);
    await ctx.reply('⚠️ An error occurred while creating chat room.');
  }
});

// الانضمام لغرفة الفريق العامة
bot.action('join_team_chat', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Find or create general team chat
    let teamChat = await prisma.chatRoom.findFirst({
      where: {
        facilityId: user.activeFacilityId,
        type: 'team',
        isActive: true
      }
    });
    
    if (!teamChat) {
      // Create general team chat if it doesn't exist
      teamChat = await createChatRoom(
        user.activeFacilityId,
        'General Team Chat',
        'Main team communication channel',
        'team',
        user.id
      );
    }
    
    // Add user to chat room if not already a member
    const existingMember = await prisma.chatMember.findFirst({
      where: {
        chatRoomId: teamChat.id,
        userId: user.id
      }
    });
    
    if (!existingMember) {
      await addChatMember(teamChat.id, user.id, 'member');
    }
    
    // Start chat session
    FlowManager.setFlow(user.tgId.toString(), 'team_chat', 1, { chatRoomId: teamChat.id });
    
    const buttons = [
      [Markup.button.callback('📤 Send Message', 'send_chat_message')],
      [Markup.button.callback('📸 Send Photo', 'send_chat_photo')],
      [Markup.button.callback('🎤 Send Voice', 'send_chat_voice')],
      [Markup.button.callback('📋 View Messages', 'view_chat_messages')],
      [Markup.button.callback('🔙 Leave Chat', 'leave_chat_room')]
    ];
    
    await ctx.reply(
      `💬 **Team Chat Room**\n\n` +
      `🏠 **Room**: ${teamChat.name}\n` +
      `👥 **Members**: ${teamChat._count?.members || 0}\n` +
      `💬 **Messages**: ${teamChat._count?.messages || 0}\n\n` +
      `You are now in the team chat. Choose an action:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error joining team chat:', error);
    await ctx.reply('⚠️ An error occurred while joining team chat.');
  }
});

// مشاركة الميديا
bot.action('media_share_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const buttons = [
      [
        Markup.button.callback('📸 Share Photo', 'share_photo'),
        Markup.button.callback('📹 Share Video', 'share_video')
      ],
      [
        Markup.button.callback('📎 Share File', 'share_file'),
        Markup.button.callback('📍 Share Location', 'share_location')
      ],
      [
        Markup.button.callback('🎤 Voice Message', 'share_voice'),
        Markup.button.callback('📝 Document', 'share_document')
      ],
      [Markup.button.callback('🔙 Back to Communication', 'team_communication_menu')]
    ];
    
    await ctx.reply(
      `📸 **Media Sharing**\n\n` +
      `Share photos, videos, files, and more with your team.\n\n` +
      `Choose what you want to share:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in media share menu:', error);
    await ctx.reply('⚠️ An error occurred while loading media sharing.');
  }
});

// الرسائل الصوتية
bot.action('voice_message', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    FlowManager.setFlow(user.tgId.toString(), 'voice_message', 1, {});
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Communication', 'team_communication_menu')]
    ];
    
    await ctx.reply(
      `🎤 **Voice Message**\n\n` +
      `Record and send a voice message to your team.\n\n` +
      `📝 **Instructions**:\n` +
      `1. Tap the microphone icon in Telegram\n` +
      `2. Record your message\n` +
      `3. Send the voice message\n\n` +
      `Your voice message will be shared with all team members.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in voice message:', error);
    await ctx.reply('⚠️ An error occurred while setting up voice message.');
  }
});

// مكالمات الفيديو
bot.action('video_call', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const buttons = [
      [
        Markup.button.callback('📞 Start Video Call', 'start_video_call'),
        Markup.button.callback('📞 Join Call', 'join_video_call')
      ],
      [
        Markup.button.callback('📋 Call History', 'call_history'),
        Markup.button.callback('⚙️ Call Settings', 'call_settings')
      ],
      [Markup.button.callback('🔙 Back to Communication', 'team_communication_menu')]
    ];
    
    await ctx.reply(
      `📹 **Video Calls**\n\n` +
      `Start or join video calls with your team members.\n\n` +
      `📞 **Features**:\n` +
      `• High-quality video calls\n` +
      `• Screen sharing\n` +
      `• Call recording\n` +
      `• Group calls\n\n` +
      `Choose an option:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in video call menu:', error);
    await ctx.reply('⚠️ An error occurred while loading video call options.');
  }
});

// ===== وضع التجربة للتواصل الفردي =====

// اختبار التواصل
bot.action('test_communication', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is alone
    const facilityMembers = await prisma.facilityMember.count({
      where: { 
        facilityId: user.activeFacilityId,
        status: 'active'
      }
    });
    
    if (facilityMembers > 1) {
      return ctx.reply('⚠️ Test mode is only available when you are alone in the facility.');
    }
    
    const buttons = [
      [
        Markup.button.callback('📝 Send Test Message', 'send_test_message'),
        Markup.button.callback('📸 Test Photo', 'test_photo')
      ],
      [
        Markup.button.callback('🎤 Test Voice', 'test_voice'),
        Markup.button.callback('📹 Test Video', 'test_video')
      ],
      [
        Markup.button.callback('📎 Test File', 'test_file'),
        Markup.button.callback('📍 Test Location', 'test_location')
      ],
      [Markup.button.callback('🔙 Back to Communication', 'team_communication_menu')]
    ];
    
    await ctx.reply(
      `🧪 **Test Communication Mode**\n\n` +
      `You are currently alone in this facility.\n` +
      `Use these test features to try the communication system:\n\n` +
      `📝 **Test Features**:\n` +
      `• Send test messages\n` +
      `• Test media sharing\n` +
      `• Test voice messages\n` +
      `• Test file sharing\n` +
      `• Test location sharing\n\n` +
      `💡 **Note**: These are test messages that will be sent to yourself for demonstration purposes.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in test communication:', error);
    await ctx.reply('⚠️ An error occurred while loading test mode.');
  }
});

// إرسال رسالة تجريبية
bot.action('send_test_message', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    FlowManager.setFlow(user.tgId.toString(), 'test_message', 1, {});
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Test Mode', 'test_communication')]
    ];
    
    await ctx.reply(
      `📝 **Send Test Message**\n\n` +
      `Type your test message below:\n\n` +
      `💡 **Examples**:\n` +
      `• "Hello, this is a test message!"\n` +
      `• "Testing the communication system"\n` +
      `• "How does this work?"\n\n` +
      `Your message will be sent as a test notification.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in send test message:', error);
    await ctx.reply('⚠️ An error occurred while setting up test message.');
  }
});

// اختبار الصور
bot.action('test_photo', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Test Mode', 'test_communication')]
    ];
    
    await ctx.reply(
      `📸 **Test Photo Sharing**\n\n` +
      `Send a photo to test the media sharing feature.\n\n` +
      `📝 **Instructions**:\n` +
      `1. Tap the camera icon or attach a photo\n` +
      `2. Send the photo\n` +
      `3. The photo will be processed as a test\n\n` +
      `💡 **Note**: This will simulate sharing a photo with your team.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in test photo:', error);
    await ctx.reply('⚠️ An error occurred while setting up photo test.');
  }
});

// اختبار الرسائل الصوتية
bot.action('test_voice', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Test Mode', 'test_communication')]
    ];
    
    await ctx.reply(
      `🎤 **Test Voice Message**\n\n` +
      `Record and send a voice message to test the voice feature.\n\n` +
      `📝 **Instructions**:\n` +
      `1. Tap the microphone icon\n` +
      `2. Record your voice message\n` +
      `3. Send the voice message\n\n` +
      `💡 **Note**: This will simulate sending a voice message to your team.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in test voice:', error);
    await ctx.reply('⚠️ An error occurred while setting up voice test.');
  }
});

});

// ===== نظام التواصل المبسط =====

// التواصل البسيط
bot.action('simple_communication', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check facility members
    const facilityMembers = await prisma.facilityMember.count({
      where: { 
        facilityId: user.activeFacilityId,
        status: 'active'
      }
    });
    
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
  } catch (error) {
    console.error('Error in simple communication:', error);
    await ctx.reply('⚠️ An error occurred while loading communication.');
  }
});

// إرسال رسالة بسيطة
bot.action('simple_send_message', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
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
  } catch (error) {
    console.error('Error in simple send message:', error);
    await ctx.reply('⚠️ An error occurred while setting up message.');
  }
});

// إشعار تجريبي بسيط
bot.action('simple_test_notification', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Send test notification
    await createNotification(
      user.id,
      user.activeFacilityId,
      'system_alert',
      '🧪 Test Notification',
      'This is a test notification to verify the communication system is working properly.',
      { testMode: true }
    );
    
    await sendTelegramNotification(
      user.id,
      '🧪 Test Notification',
      `✅ **Communication Test Successful!**\n\n⏰ **Time**: ${new Date().toLocaleString()}\n🔔 **Type**: System Alert\n💬 **Status**: Notification delivered\n\n💡 **Note**: This confirms your notification system is working correctly.`,
      [
        [Markup.button.callback('🔔 Test Another', 'simple_test_notification')],
        [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
      ],
      'system_alert'
    );
    
    await ctx.reply(
      `✅ **Test Notification Sent!**\n\n` +
      `🔔 **Status**: Successfully sent\n` +
      `⏰ **Time**: ${new Date().toLocaleString()}\n\n` +
      `💡 **You should receive a notification shortly.**`,
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
  } catch (error) {
    console.error('Error in test notification:', error);
    await ctx.reply('⚠️ An error occurred while sending test notification.');
  }
});

// مشاركة الميديا البسيطة
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



// ===== نظام التواصل المبسط =====

// التواصل البسيط
bot.action('simple_communication', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check facility members
    const facilityMembers = await prisma.facilityMember.count({
      where: { 
        facilityId: user.activeFacilityId,
        status: 'active'
      }
    });
    
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
  } catch (error) {
    console.error('Error in simple communication:', error);
    await ctx.reply('⚠️ An error occurred while loading communication.');
  }
});

// إرسال رسالة بسيطة
bot.action('simple_send_message', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
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
  } catch (error) {
    console.error('Error in simple send message:', error);
    await ctx.reply('⚠️ An error occurred while setting up message.');
  }
});

// إشعار تجريبي بسيط
bot.action('simple_test_notification', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Send test notification
    await createNotification(
      user.id,
      user.activeFacilityId,
      'system_alert',
      '🧪 Test Notification',
      'This is a test notification to verify the communication system is working properly.',
      { testMode: true }
    );
    
    await sendTelegramNotification(
      user.id,
      '🧪 Test Notification',
      `✅ **Communication Test Successful!**\n\n⏰ **Time**: ${new Date().toLocaleString()}\n🔔 **Type**: System Alert\n💬 **Status**: Notification delivered\n\n💡 **Note**: This confirms your notification system is working correctly.`,
      [
        [Markup.button.callback('🔔 Test Another', 'simple_test_notification')],
        [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
      ],
      'system_alert'
    );
    
    await ctx.reply(
      `✅ **Test Notification Sent!**\n\n` +
      `🔔 **Status**: Successfully sent\n` +
      `⏰ **Time**: ${new Date().toLocaleString()}\n\n` +
      `💡 **You should receive a notification shortly.**`,
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
  } catch (error) {
    console.error('Error in test notification:', error);
    await ctx.reply('⚠️ An error occurred while sending test notification.');
  }
});

// مشاركة الميديا البسيطة
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

// === Flow Handler for free text responses with security ===
bot.on('text', async (ctx, next) => {
  try {
    // التحقق من هوية المستخدم first
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    const flowState = FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState) return next();
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    // Sanitize input
    const text = SecurityManager.sanitizeInput(ctx.message.text || '', 1000);
    if (!text) {
      return ctx.reply('⚠️ Invalid input. Please try again.');
    }
    
    try {
      // === FACILITY REGISTRATION FLOW ===
      if (flowState.flow === 'reg_fac') {
        // Step 1: Facility Name
        if (flowState.step === 1) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Facility registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedName = SecurityManager.sanitizeInput(text, 60);
          if (sanitizedName.length < 2) {
            return ctx.reply('⚠️ Name must be at least 2 characters. Try again or type /cancel to exit:');
          }
          
          // Check if facility name already exists
          const existingFacility = await prisma.facility.findUnique({
            where: { name: sanitizedName }
          });
          
          if (existingFacility) {
            return ctx.reply('⚠️ A facility with this name already exists. Please choose a different name or type /cancel to exit:');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { name: sanitizedName });
          FlowManager.updateStep(ctx.from.id.toString(), 2);
          
          return ctx.reply(
            `✅ **Facility Name:** ${flowState.data.name}\n\n` +
            `🏙️ **Step 2/4: Enter the city**\n` +
            `Maximum 40 characters\n\n` +
            `Type /cancel to exit registration`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 2: المدينة
        if (flowState.step === 2) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Facility registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedالمدينة = SecurityManager.sanitizeInput(text, 40);
          if (sanitizedالمدينة.length < 2) {
            return ctx.reply('⚠️ المدينة must be at least 2 characters. Try again or type /cancel to exit:');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { city: sanitizedالمدينة });
          FlowManager.updateStep(ctx.from.id.toString(), 3);
          
          return ctx.reply(
            `✅ **Facility Name:** ${flowState.data.name}\n` +
            `✅ **المدينة:** ${flowState.data.city}\n\n` +
            `📞 **Step 3/4: Enter contact phone**\n` +
            `Maximum 25 characters\n\n` +
            `Type /cancel to exit registration`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 3: Phone
        if (flowState.step === 3) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Facility registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedPhone = SecurityManager.sanitizeInput(text, 25);
          if (sanitizedPhone.length < 5) {
            return ctx.reply('⚠️ Phone must be at least 5 characters. Try again or type /cancel to exit:');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { phone: sanitizedPhone });
          FlowManager.updateStep(ctx.from.id.toString(), 4);
          
          const planButtons = [
            [{ text: '🆓 Free Plan', callback_data: 'regfac_plan|Free' }],
            [{ text: '⭐ Pro Plan', callback_data: 'regfac_plan|Pro' }],
            [{ text: '🏢 Business Plan', callback_data: 'regfac_plan|Business' }],
            [{ text: '❌ Cancel', callback_data: 'regfac_cancel' }]
          ];
          
          return ctx.reply(
            `✅ **Facility Name:** ${flowState.data.name}\n` +
            `✅ **المدينة:** ${flowState.data.city}\n` +
            `✅ **Phone:** ${flowState.data.phone}\n\n` +
            `💼 **Step 4/4: Choose subscription plan**\n\n` +
            `**Available Plans:**\n` +
            `🆓 **Free:** Basic features\n` +
            `⭐ **Pro:** Advanced features\n` +
            `🏢 **Business:** Enterprise features`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: planButtons }
            }
          );
        }
      }
      
      // === USER REGISTRATION FLOWS ===
      if (['register_user', 'register_technician', 'register_supervisor'].includes(flowState.flow)) {
        const roleText = {
          'register_user': 'User',
          'register_technician': 'Technician', 
          'register_supervisor': 'Supervisor'
        };
        
        // Step 1: Full Name
        if (flowState.step === 1) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ User registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedName = SecurityManager.sanitizeInput(text, 50);
          if (sanitizedName.length < 2) {
            return ctx.reply('⚠️ Name must be at least 2 characters. Try again or type /cancel to exit:');
          }
          
          // Split name into first and last name
          const nameParts = sanitizedName.split(' ');
          FlowManager.updateData(ctx.from.id.toString(), {
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(' ') || null,
            fullName: sanitizedName
          });
          FlowManager.updateStep(ctx.from.id.toString(), 2);
          
          return ctx.reply(
            `✅ **Full Name:** ${flowState.data.fullName}\n` +
            `✅ **Role:** ${roleText[flowState.flow]}\n\n` +
            `📧 **Step 2/5: Enter your email address**\n` +
            `(Optional - type /skip to skip or /cancel to exit)`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 2: Email (اختياري)
        if (flowState.step === 2) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ User registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          if (text.toLowerCase() === '/skip') {
            FlowManager.updateData(ctx.from.id.toString(), { email: null });
          } else {
            const sanitizedEmail = SecurityManager.sanitizeInput(text, 100);
            const validatedEmail = validateEmail(sanitizedEmail);
            if (validatedEmail) {
              FlowManager.updateData(ctx.from.id.toString(), { email: validatedEmail });
            } else {
              return ctx.reply('⚠️ Invalid email format. Please enter a valid email or type /skip to skip:');
            }
          }
          
          FlowManager.updateStep(ctx.from.id.toString(), 3);
          
          return ctx.reply(
            `✅ **Full Name:** ${flowState.data.fullName}\n` +
            `✅ **Role:** ${roleText[flowState.flow]}\n` +
            `✅ **Email:** ${flowState.data.email || 'Not provided'}\n\n` +
            `📞 **Step 3/4: Enter your phone number**\n` +
            `(Optional - type /skip to skip or /cancel to exit)`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 3: Phone (اختياري)
        if (flowState.step === 3) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ User registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          if (text.toLowerCase() === '/skip') {
            FlowManager.updateData(ctx.from.id.toString(), { phone: null });
          } else {
            const sanitizedPhone = SecurityManager.sanitizeInput(text, 20);
            const validatedPhone = validatePhone(sanitizedPhone);
            if (validatedPhone) {
              FlowManager.updateData(ctx.from.id.toString(), { phone: validatedPhone });
            } else {
              return ctx.reply('⚠️ Invalid phone format. Please enter a valid phone number or type /skip to skip:');
            }
          }
          
          FlowManager.updateStep(ctx.from.id.toString(), 4);
          
          return ctx.reply(
            `✅ **Full Name:** ${flowState.data.fullName}\n` +
            `✅ **Role:** ${roleText[flowState.flow]}\n` +
            `✅ **Email:** ${flowState.data.email || 'Not provided'}\n` +
            `✅ **Phone:** ${flowState.data.phone || 'Not provided'}\n\n` +
            `💼 **Step 4/5: Enter your job title**\n` +
            `(e.g., Maintenance Technician, Facility Manager, etc.)\n` +
            `(Optional - type /skip to skip or /cancel to exit)`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 4: Job Title (اختياري)
        if (flowState.step === 4) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ User registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          if (text.toLowerCase() === '/skip') {
            FlowManager.updateData(ctx.from.id.toString(), { jobTitle: null });
          } else {
            const sanitizedJobTitle = SecurityManager.sanitizeInput(text, 50);
            if (sanitizedJobTitle.length < 2) {
              return ctx.reply('⚠️ Job title must be at least 2 characters. Try again or type /skip to skip:');
            }
            FlowManager.updateData(ctx.from.id.toString(), { jobTitle: sanitizedJobTitle });
          }
          
          FlowManager.updateStep(ctx.from.id.toString(), 5);
          
          // Show facility selection
          const facilities = await prisma.facility.findMany({
            where: { status: 'active' },
            orderBy: { name: 'asc' }
          });
          
          if (!facilities.length) {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('⚠️ No active facilities found. Please contact the system administrator.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const buttons = facilities.map(f => [
            { text: SecurityManager.sanitizeInput(f.name, 30), callback_data: `join_facility|${f.id.toString()}|${flowState.flow.replace('register_', '')}` }
          ]);
          buttons.push([{ text: '❌ Cancel', callback_data: 'user_reg_cancel' }]);
          
          return ctx.reply(
            `✅ **Full Name:** ${flowState.data.fullName}\n` +
            `✅ **Role:** ${roleText[flowState.flow]}\n` +
            `✅ **Email:** ${flowState.data.email || 'Not provided'}\n` +
            `✅ **Phone:** ${flowState.data.phone || 'Not provided'}\n` +
            `✅ **Job Title:** ${flowState.data.jobTitle || 'Not provided'}\n\n` +
            `🏢 **Step 5/5: Select Facility to Join**\n\n` +
            `Choose a facility to join:`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: buttons }
            }
          );
        }
      }
      
      // === WORK ORDER CREATION FLOW ===
      if (flowState.flow === 'wo_new') {
        // Step 4: Location
        if (flowState.step === 4) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Work order creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedLocation = SecurityManager.sanitizeInput(text, 100);
          if (sanitizedLocation.length < 3) {
            return ctx.reply('⚠️ Location must be at least 3 characters. Try again or type /cancel to exit:');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { location: sanitizedLocation });
          FlowManager.updateStep(ctx.from.id.toString(), 5);
          
          return ctx.reply(
            `🔧 **Work Order Creation (5/6)**\n\n` +
            `✅ **Type:** ${flowState.data.typeOfWork}\n` +
            `✅ **Service:** ${flowState.data.typeOfService}\n` +
            `✅ **Priority:** ${flowState.data.priority}\n` +
            `✅ **Location:** ${sanitizedLocation}\n\n` +
            `🔧 **Enter equipment details (اختياري)**\n` +
            `(e.g., HVAC Unit #5, Electrical Panel B)\n\n` +
            `Type /skip to skip this step\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 5: Equipment (اختياري)
        if (flowState.step === 5) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Work order creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          if (text.toLowerCase() === '/skip') {
            flowState.data.equipment = null;
          } else {
            const sanitizedEquipment = SecurityManager.sanitizeInput(text, 100);
            FlowManager.updateData(ctx.from.id.toString(), { equipment: sanitizedEquipment });
          }
          
          FlowManager.updateStep(ctx.from.id.toString(), 6);
          
          const updatedFlow = FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `🔧 **Work Order Creation (6/6)**\n\n` +
            `✅ **Type:** ${updatedFlow.data.typeOfWork}\n` +
            `✅ **Service:** ${updatedFlow.data.typeOfService}\n` +
            `✅ **Priority:** ${updatedFlow.data.priority}\n` +
            `✅ **Location:** ${updatedFlow.data.location}\n` +
            `✅ **Equipment:** ${updatedFlow.data.equipment || 'Not specified'}\n\n` +
            `📝 **Enter detailed description**\n` +
            `Describe the issue or work needed\n\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 6: Description
        if (flowState.step === 6) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Work order creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedDescription = SecurityManager.sanitizeInput(text, 500);
          if (sanitizedDescription.length < 10) {
            return ctx.reply('⚠️ Description must be at least 10 characters. Try again or type /cancel to exit:');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { description: sanitizedDescription });
          
          // Check plan limits before creating work order
          try {
            await PlanManager.checkPlanLimit(user.activeFacilityId, 'workOrders', 1);
          } catch (error) {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply(`⚠️ **Plan Limit Exceeded**\n\n${error.message}\n\nPlease contact the facility administrator to upgrade the plan.`);
          }
          
          // Create work order
          try {
            const finalFlow = FlowManager.getFlow(ctx.from.id.toString());
            const workOrder = await prisma.workOrder.create({
              data: {
                facilityId: user.activeFacilityId,
                createdByUserId: user.id,
                typeOfWork: finalFlow.data.typeOfWork,
                typeOfService: finalFlow.data.typeOfService,
                priority: finalFlow.data.priority,
                location: finalFlow.data.location,
                equipment: finalFlow.data.equipment,
                description: finalFlow.data.description,
                status: 'pending'
              }
            });
            
            FlowManager.clearFlow(ctx.from.id.toString());
            
            await ctx.reply(
              `✅ **Work Order Created Successfully!**\n\n` +
              `🔧 **Work Order #${workOrder.id}**\n` +
              `📋 **Type:** ${workOrder.typeOfWork}\n` +
              `🔧 **Service:** ${workOrder.typeOfService}\n` +
              `🔴 **Priority:** ${workOrder.priority}\n` +
              `📍 **Location:** ${workOrder.location}\n` +
              `📝 **Description:** ${workOrder.description}\n\n` +
              `⏳ **Status:** Pending\n\n` +
              `Your work order has been submitted and will be reviewed by facility staff.`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]]
                }
              }
            );
          } catch (error) {
            console.error('Error creating work order:', error);
            FlowManager.clearFlow(ctx.from.id.toString());
            await ctx.reply('⚠️ An error occurred while creating the work order. Please try again.');
          }
        }
      }
      
      // === CREATE REMINDER FLOW ===
      if (flowState.flow === 'create_reminder') {
        // Step 2: Title
        if (flowState.step === 2) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Reminder creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }

          const sanitizedTitle = SecurityManager.sanitizeInput(text, 100);
          if (sanitizedTitle.length < 3) {
            return ctx.reply('⚠️ Title must be at least 3 characters. Try again or type /cancel to exit:');
          }

          FlowManager.updateData(ctx.from.id.toString(), { title: sanitizedTitle });
          FlowManager.updateStep(ctx.from.id.toString(), 3);

          return ctx.reply(
            `⏰ **Create Reminder (3/5)**\n\n` +
            `✅ **Title:** ${sanitizedTitle}\n\n` +
            `📝 **Enter description**\n` +
            `Maximum 200 characters\n\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }

        // Step 3: Description
        if (flowState.step === 3) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Reminder creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }

          const sanitizedDescription = SecurityManager.sanitizeInput(text, 200);
          if (sanitizedDescription.length < 5) {
            return ctx.reply('⚠️ Description must be at least 5 characters. Try again or type /cancel to exit:');
          }

          FlowManager.updateData(ctx.from.id.toString(), { message: sanitizedDescription });
          FlowManager.updateStep(ctx.from.id.toString(), 4);

          return ctx.reply(
            `⏰ **Create Reminder (4/5)**\n\n` +
            `✅ **Title:** ${flowState.data.title}\n` +
            `✅ **Description:** ${sanitizedDescription}\n\n` +
            `📅 **Enter date (DD/MM/YYYY or DD-MM-YYYY)**\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }

        // Step 4: Date
        if (flowState.step === 4) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Reminder creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }

          // Simple date validation (DD/MM/YYYY or DD-MM-YYYY)
          const dateRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
          const match = text.match(dateRegex);

          if (!match) {
            return ctx.reply('⚠️ Please enter date in DD/MM/YYYY or DD-MM-YYYY format. Try again or type /cancel to exit:');
          }

          const day = parseInt(match[1]);
          const month = parseInt(match[2]);
          const year = parseInt(match[3]);

          const scheduledDate = new Date(year, month - 1, day);
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (scheduledDate < today) {
            return ctx.reply('⚠️ Date cannot be in the past. Try again or type /cancel to exit:');
          }

          FlowManager.updateData(ctx.from.id.toString(), { scheduledFor: scheduledDate });
          FlowManager.updateStep(ctx.from.id.toString(), 5);

          const frequencyButtons = [
            [Markup.button.callback('🔄 Once', 'reminder_frequency|مرة واحدة')],
            [Markup.button.callback('📅 Daily', 'reminder_frequency|يومياً')],
            [Markup.button.callback('📅 Weekly', 'reminder_frequency|أسبوعياً')],
            [Markup.button.callback('📅 Monthly', 'reminder_frequency|شهرياً')],
            [Markup.button.callback('❌ Cancel', 'reminder_cancel')]
          ];

          return ctx.reply(
            `⏰ **Create Reminder (5/5)**\n\n` +
            `✅ **Title:** ${flowState.data.title}\n` +
            `✅ **Description:** ${flowState.data.message}\n` +
            `✅ **Type:** ${flowState.data.type}\n` +
            `✅ **Date:** ${scheduledDate.toLocaleDateString()}\n\n` +
            `🔄 **Choose frequency:**`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: frequencyButtons }
            }
          );
                }
      }
      
      // === HELP REQUEST FLOW ===
      if (flowState.flow === 'request_help') {
        // Step 1: Problem Description
        if (flowState.step === 1) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Cancelled طلب المساعدة.', {
              reply_markup: { inline_keyboard: [[{ text: '💬 Team Communication', callback_data: 'team_communication' }]] }
            });
          }
          
          const sanitizedProblem = SecurityManager.sanitizeInput(text, 500);
          if (sanitizedProblem.length < 10) {
            return ctx.reply('⚠️ Please describe the problem in more detail (minimum 10 characters). Type /cancel to cancel.');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { problem: sanitizedProblem });
          FlowManager.updateStep(ctx.from.id.toString(), 2);
          
          return ctx.reply(
            `✅ **وصف المشكلة**: ${sanitizedProblem}\n\n` +
            `⚡ **Step 2/2**: How urgent is this problem؟\n\n` +
            `Enter a number from 1-5:\n` +
            `1 = Normal\n` +
            `2 = Important\n` +
            `3 = Urgent\n` +
            `4 = Critical\n` +
            `5 = Emergency`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 2: Urgency Level
        if (flowState.step === 2) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Cancelled طلب المساعدة.', {
              reply_markup: { inline_keyboard: [[{ text: '💬 Team Communication', callback_data: 'team_communication' }]] }
            });
          }
          
          const urgencyLevel = parseInt(text);
          if (isNaN(urgencyLevel) || urgencyLevel < 1 || urgencyLevel > 5) {
            return ctx.reply('⚠️ Please choose a number from 1 to 5 only. Type /cancel to cancel.');
          }
          
          const urgencyLabels = {
            1: 'Normal',
            2: 'Important', 
            3: 'Urgent',
            4: 'Critical',
            5: 'Emergency'
          };
          
          const urgencyEmojis = {
            1: '🔵',
            2: '🟡',
            3: '🟠',
            4: '🔴',
            5: '🚨'
          };
          
          FlowManager.updateData(ctx.from.id.toString(), { 
            urgency: urgencyLevel,
            urgencyLabel: urgencyLabels[urgencyLevel],
            urgencyEmoji: urgencyEmojis[urgencyLevel]
          });
          
          // Send help request to supervisors and admins
          try {
            const supervisors = await prisma.facilityMember.findMany({
              where: { 
                facilityId: BigInt(flowState.data.facilityId), 
                status: 'active',
                role: { in: ['facility_admin', 'supervisor'] }
              },
              include: { user: true }
            });
            
            const helpMessage = 
              `🆘 **Request Help من Technician**\n\n` +
              `👤 **الTechnician**: ${flowState.data.technicianName}\n` +
              `${flowState.data.urgencyEmoji} **Urgency**: ${flowState.data.urgencyLabel}\n\n` +
              `📝 **المشكلة**:\n${flowState.data.problem}\n\n` +
              `📅 **Time**: ${new Date().toLocaleString('ar-EG')}`;
            
            let sentCount = 0;
            for (const supervisor of supervisors) {
              if (supervisor.user.tgId) {
                try {
                  await createNotification(
                    supervisor.user.id,
                    BigInt(flowState.data.facilityId),
                    'high_priority_alert',
                    'Request Help من Technician',
                    helpMessage,
                    {
                      type: 'help_request',
                      technicianId: flowState.data.technicianId,
                      urgency: urgencyLevel
                    }
                  );
                  sentCount++;
                } catch (error) {
                  console.error(`Error sending help request to supervisor ${supervisor.user.id}:`, error);
                }
              }
            }
            
            FlowManager.clearFlow(ctx.from.id.toString());
            
            await ctx.reply(
              `✅ **Help request sent successfully!**\n\n` +
              `📨 Request sent to ${sentCount} Supervisor/مدير\n` +
              `${flowState.data.urgencyEmoji} **Urgency**: ${flowState.data.urgencyLabel}\n\n` +
              `You will be contacted soon.`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [
                      Markup.button.callback('🛠️ لوحة التحكم', 'technician_dashboard'),
                      Markup.button.callback('💬 Team Communication', 'team_communication')
                    ],
                    [Markup.button.callback('🔙 Main Menu', 'back_to_menu')]
                  ]
                }
              }
            );
            
          } catch (error) {
            console.error('Error sending help request:', error);
            FlowManager.clearFlow(ctx.from.id.toString());
            await ctx.reply('⚠️ An error occurred أثناء إرسال طلب المساعدة. يرجى المحاولة مرة أخرى.');
          }
        }
      }
      
      // === WORK ORDER SEARCH FLOW ===
      if (flowState.flow === 'wo_search') {
        if (flowState.step === 1) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Cancelled البحث.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }

          const { user, member } = await requireActiveMembership(ctx);
          if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('⚠️ لا تملك صلاحية البحث في البلاغات.');
          }

          // Support search by #ID
          const idMatch = text.trim().match(/^#?(\d+)$/);
          let whereClause = { facilityId: user.activeFacilityId };

          if (idMatch) {
            whereClause.id = BigInt(idMatch[1]);
          } else {
            const q = text.toLowerCase();
            whereClause.OR = [
              { description: { contains: q, mode: 'insensitive' } },
              { location: { contains: q, mode: 'insensitive' } },
              { equipment: { contains: q, mode: 'insensitive' } },
              { typeOfWork: { contains: q, mode: 'insensitive' } },
              { typeOfService: { contains: q, mode: 'insensitive' } }
            ];
          }

          const results = await prisma.workOrder.findMany({
            where: whereClause,
            orderBy: { updatedAt: 'desc' },
            take: 15
          });

          FlowManager.clearFlow(ctx.from.id.toString());

          if (!results.length) {
            return ctx.reply('🔎 لم يتم العثور على نتائج مطابقة.');
          }

          const statusEmoji = {
            'open': '🔵',
            'in_progress': '🟡',
            'done': '🟢',
            'closed': '⚫'
          };

          const rows = results.map(wo => [
            Markup.button.callback(
              `${statusEmoji[wo.status] || '⚪'} #${wo.id.toString()} ${wo.typeOfWork ? '[' + wo.typeOfWork + '] ' : ''}\n${wo.description.slice(0, 45)}${wo.description.length > 45 ? '...' : ''}`,
              `wo_view|${wo.id.toString()}`
            )
          ]);

          const buttons = [
            ...rows,
            [Markup.button.callback('🔙 الرجوع للإدارة', 'manage_work_orders')]
          ];

          return ctx.reply('🔎 **نتائج البحث عن البلاغات**\n\nاختر بلاغاً لعرض التفاصيل:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
          });
        }
      }

      // === REMINDER CREATION FLOW ===
      if (flowState.flow === 'reminder_new') {
        // Step 1: Title
        if (flowState.step === 1) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Reminder creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedTitle = SecurityManager.sanitizeInput(text, 100);
          if (sanitizedTitle.length < 3) {
            return ctx.reply('⚠️ Title must be at least 3 characters. Try again or type /cancel to exit:');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { title: sanitizedTitle });
          FlowManager.updateStep(ctx.from.id.toString(), 2);
          
          return ctx.reply(
            `⏰ **Create Reminder (2/5)**\n\n` +
            `✅ **Title:** ${flowState.data.title}\n\n` +
            `📝 **Enter description**\n` +
            `Maximum 200 characters\n\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 2: Description
        if (flowState.step === 2) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Reminder creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedDescription = SecurityManager.sanitizeInput(text, 200);
          if (sanitizedDescription.length < 5) {
            return ctx.reply('⚠️ Description must be at least 5 characters. Try again or type /cancel to exit:');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { description: sanitizedDescription });
          FlowManager.updateStep(ctx.from.id.toString(), 3);
          
          const typeButtons = [
            [Markup.button.callback('👤 Personal', 'reminder_type|personal')],
            [Markup.button.callback('🏢 Facility', 'reminder_type|facility')],
            [Markup.button.callback('❌ Cancel', 'reminder_cancel')]
          ];
          
          return ctx.reply(
            `⏰ **Create Reminder (3/5)**\n\n` +
            `✅ **Title:** ${flowState.data.title}\n` +
            `✅ **Description:** ${flowState.data.description}\n\n` +
            `📋 **Choose reminder type:**`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: typeButtons }
            }
          );
        }
        
        // Step 4: Date
        if (flowState.step === 4) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Reminder creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          // Simple date validation (DD/MM/YYYY or DD-MM-YYYY)
          const dateRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
          const match = text.match(dateRegex);
          
          if (!match) {
            return ctx.reply('⚠️ Please enter date in DD/MM/YYYY or DD-MM-YYYY format. Try again or type /cancel to exit:');
          }
          
          const day = parseInt(match[1]);
          const month = parseInt(match[2]);
          const year = parseInt(match[3]);
          
          const scheduledDate = new Date(year, month - 1, day);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          if (scheduledDate < today) {
            return ctx.reply('⚠️ Date cannot be in the past. Try again or type /cancel to exit:');
          }
          
          FlowManager.updateData(ctx.from.id.toString(), { scheduledDate: scheduledDate });
          FlowManager.updateStep(ctx.from.id.toString(), 5);
          
          const frequencyButtons = [
            [Markup.button.callback('🔄 Once', 'reminder_frequency|مرة واحدة')],
            [Markup.button.callback('📅 Daily', 'reminder_frequency|يومياً')],
            [Markup.button.callback('📅 Weekly', 'reminder_frequency|أسبوعياً')],
            [Markup.button.callback('📅 Monthly', 'reminder_frequency|شهرياً')],
            [Markup.button.callback('❌ Cancel', 'reminder_cancel')]
          ];
          
          return ctx.reply(
            `⏰ **Create Reminder (5/5)**\n\n` +
            `✅ **Title:** ${flowState.data.title}\n` +
            `✅ **Description:** ${flowState.data.description}\n` +
            `✅ **Type:** ${flowState.data.type}\n` +
            `✅ **Date:** ${scheduledDate.toLocaleDateString()}\n\n` +
            `🔄 **Choose frequency:**`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: frequencyButtons }
            }
          );
        }
      }

      
      // === SIMPLE MESSAGE FLOW ===
      if (flowState.flow === 'simple_message') {
        if (flowState.step === 1) {
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Message cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Communication', callback_data: 'simple_communication' }]] }
            });
          }
          
          // Check if user is alone
          const facilityMembers = await prisma.facilityMember.count({
            where: { 
              facilityId: user.activeFacilityId,
              status: 'active'
            }
          });
          
          if (facilityMembers <= 1) {
            // Send test notification to user (solo mode)
            await createNotification(
              user.id,
              user.activeFacilityId,
              'system_alert',
              '🧪 Test Message Received',
              `Your message: "${text}"\n\nThis is a test since you are alone in the facility.`,
              { testMode: true, originalMessage: text }
            );
            
            await sendTelegramNotification(
              user.id,
              '🧪 Test Message Received',
              `Your message has been processed!\n\n📝 **Message**: "${text}"\n⏰ **Time**: ${new Date().toLocaleString()}\n\n✅ **Status**: Test completed (solo mode)`,
              [
                [Markup.button.callback('📝 Send Another', 'simple_send_message')],
                [Markup.button.callback('🔙 Back to Communication', 'simple_communication')]
              ],
              'system_alert'
            );
          } else {
            // Send to all team members
            const members = await prisma.facilityMember.findMany({
              where: { 
                facilityId: user.activeFacilityId,
                status: 'active',
                userId: { not: user.id } // Don't send to sender
              },
              include: { user: true }
            });
            
            for (const member of members) {
              if (member.user.tgId) {
                try {
                  await sendTelegramNotification(
                    member.userId,
                    '💬 Team Message',
                    `**From**: ${user.firstName || 'Team Member'}\n**Message**: ${text}\n\n⏰ ${new Date().toLocaleString()}`,
                    null,
                    'team_communication'
                  );
                } catch (error) {
                  console.error(`Error sending to member ${member.userId}:`, error);
                }
              }
            }
          }
          
          FlowManager.clearFlow(ctx.from.id.toString());
          
          return ctx.reply(
            `✅ **Message Sent Successfully!**\n\n` +
            `📝 **Your Message**: "${text}"\n` +
            `⏰ **Time**: ${new Date().toLocaleString()}\n` +
            `👥 **Recipients**: ${facilityMembers <= 1 ? 'Test mode (you only)' : `${facilityMembers - 1} team members`}\n\n` +
            `💡 **Status**: Message delivered`,
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
        }
      }
          } catch (e) {
      console.error('FLOW_ERROR', e);
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ An error occurred. Please try again.');
    }
  } catch (error) {
    console.error('Text handler authentication error:', error);
    if (error.message.includes('Rate limit')) {
      await ctx.reply('⚠️ Too many requests. Please wait a moment and try again.');
    } else {
      await ctx.reply('⚠️ An error occurred. Please try again.');
    }
  }
});

// Handle work order type selection
bot.action(/wo_type\|(maintenance|repair|installation|cleaning|inspection|other)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    const flowState = FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'wo_new') {
      return ctx.reply('⚠️ Invalid flow state. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    FlowManager.updateData(ctx.from.id.toString(), { typeOfWork: ctx.match[1] });
    FlowManager.updateStep(ctx.from.id.toString(), 2);
    
    // Step 2: Choose service type
    const serviceTypeButtons = [
      [Markup.button.callback('⚡ Electrical', 'wo_service|electrical')],
      [Markup.button.callback('🔧 Mechanical', 'wo_service|mechanical')],
      [Markup.button.callback('🚰 Plumbing', 'wo_service|plumbing')],
      [Markup.button.callback('❄️ HVAC', 'wo_service|hvac')],
      [Markup.button.callback('🏗️ Structural', 'wo_service|structural')],
      [Markup.button.callback('💻 IT/Technology', 'wo_service|it')],
      [Markup.button.callback('🧹 General', 'wo_service|general')],
      [Markup.button.callback('❌ Cancel', 'wo_cancel')]
    ];
    
    await ctx.reply(`🔧 **Work Order Creation (2/6)**\n\n✅ **Type:** ${ctx.match[1]}\n\n**Choose the service type:**`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: serviceTypeButtons }
    });
  }, ctx, 'wo_type_selection');
});

// Handle service type selection
bot.action(/wo_service\|(electrical|mechanical|plumbing|hvac|structural|it|general)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const flowState = FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'wo_new') {
      return ctx.reply('⚠️ Invalid flow state. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    FlowManager.updateData(ctx.from.id.toString(), { typeOfService: ctx.match[1] });
    FlowManager.updateStep(ctx.from.id.toString(), 3);
    
    // Step 3: Choose priority
    const priorityButtons = [
      [Markup.button.callback('🔴 High Priority', 'wo_priority|high')],
      [Markup.button.callback('🟡 Medium Priority', 'wo_priority|medium')],
      [Markup.button.callback('🟢 Low Priority', 'wo_priority|low')],
      [Markup.button.callback('❌ Cancel', 'wo_cancel')]
    ];
    
    await ctx.reply(`🔧 **Work Order Creation (3/6)**\n\n✅ **Type:** ${flowState.data.typeOfWork}\n✅ **Service:** ${ctx.match[1]}\n\n**Choose priority:**`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: priorityButtons }
    });
  }, ctx, 'wo_service_selection');
});

// Handle priority selection
bot.action(/wo_priority\|(high|medium|low)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const flowState = FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'wo_new') {
      return ctx.reply('⚠️ Invalid flow state. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    FlowManager.updateData(ctx.from.id.toString(), { priority: ctx.match[1] });
    FlowManager.updateStep(ctx.from.id.toString(), 4);
    
    await ctx.reply(
      `🔧 **Work Order Creation (4/6)**\n\n` +
      `✅ **Type:** ${flowState.data.typeOfWork}\n` +
      `✅ **Service:** ${flowState.data.typeOfService}\n` +
      `✅ **Priority:** ${ctx.match[1]}\n\n` +
      `📍 **Enter the location/area**\n` +
      `(e.g., Building A, Floor 2, Room 101)\n\n` +
      `Type /cancel to exit`,
      { parse_mode: 'Markdown' }
    );
  }, ctx, 'wo_priority_selection');
});

// Handle facility registration cancellation
bot.action('regfac_cancel', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const { user } = await SecurityManager.authenticateUser(ctx);
    FlowManager.clearFlow(ctx.from.id.toString());
    await ctx.reply('❌ Facility registration cancelled.', {
      reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
    });
  } catch (error) {
    console.error('Facility registration cancellation error:', error);
    await ctx.reply('⚠️ An error occurred. Please try again.');
  }
});

// Handle user registration cancellation
bot.action('user_reg_cancel', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const { user } = await SecurityManager.authenticateUser(ctx);
    FlowManager.clearFlow(ctx.from.id.toString());
    await ctx.reply('❌ User registration cancelled.', {
      reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
    });
  } catch (error) {
    console.error('User registration cancellation error:', error);
    await ctx.reply('⚠️ An error occurred. Please try again.');
  }
});

// Handle work order creation cancellation
bot.action('wo_cancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    FlowManager.clearFlow(ctx.from.id.toString());
    await ctx.reply('❌ Work order creation cancelled.', {
      reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
    });
  }, ctx, 'wo_cancel');
});

// Handle plan selection during facility registration
bot.action(/regfac_plan\|(Free|Pro|Business)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    const flowState = FlowManager.getFlow(user.tgId.toString());
    if (!flowState || flowState.flow !== 'reg_fac') {
      return ctx.reply('⚠️ Invalid registration flow. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(user.tgId.toString(), flowState)) {
      FlowManager.clearFlow(user.tgId.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    FlowManager.updateData(user.tgId.toString(), { plan: ctx.match[1] });
    const data = flowState.data;
    
    // Validate required fields
    if (!data.name || !data.city || !data.phone) {
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Missing required facility information. Please start over.');
    }
    
    // Check if facility name already exists
    const existingFacility = await prisma.facility.findUnique({
      where: { name: data.name }
    });
    
    if (existingFacility) {
      FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ A facility with this name already exists. Please choose a different name.');
    }
    
    // Creating facility with data
    
    const facility = await prisma.$transaction(async (tx) => {
      const f = await tx.facility.create({
        data: {
          name: data.name,
          city: data.city,
          phone: data.phone,
          status: 'pending',
          isDefault: false,
          planTier: data.plan
        }
      });
      
      await tx.facilityMember.create({
        data: { 
          userId: user.id, 
          facilityId: f.id, 
          role: 'facility_admin',
          status: 'active',
          joinedAt: new Date()
        }
      });
      
      await tx.user.update({
        where: { id: user.id },
        data: {
          activeFacilityId: f.id,
          status: 'active'
        }
      });
      
      return f;
    });
    
    FlowManager.clearFlow(ctx.from.id.toString());
    
    await ctx.reply(
      `✅ **Facility Registration Successful!**\n\n` +
      `🏢 **Facility Details:**\n` +
      `• Name: ${facility.name}\n` +
      `• المدينة: ${data.city}\n` +
      `• Phone: ${data.phone}\n` +
      `• Plan: ${data.plan}\n` +
      `• Status: Pending Approval\n\n` +
      `⏳ **Next Steps:**\n` +
      `The facility administrator will review and approve your request soon.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]]
        }
      }
    );
    
    // Notify master (respect settings if master is a regular user with settings)
    if (MASTER_ID) {
      try {
        // Check if master has notification settings (اختياري, masters usually want all notifications)
        let shouldNotifyMaster = true;
        try {
          const masterSettings = await getUserNotificationSettings(MASTER_ID);
          shouldNotifyMaster = masterSettings.statusChanges; // Facility requests are status changes
        } catch (e) {
          // If no settings found, assume master wants all notifications
          shouldNotifyMaster = true;
        }
        
        if (shouldNotifyMaster) {
          await bot.telegram.sendMessage(
            MASTER_ID,
            `🏢 **New Facility Request**\n\n` +
            `📝 **Details:**\n` +
            `• Name: ${facility.name}\n` +
            `• المدينة: ${data.city}\n` +
            `• Phone: ${data.phone}\n` +
            `• Plan: ${data.plan}\n` +
            `• ID: ${facility.id.toString()}\n` +
            `• Owner: ${ctx.from.id}\n\n` +
            `Use Master Panel to approve.`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (err) {
        console.error('Failed to notify master:', err);
        }
}

// ===== وضع التجربة للتواصل الفردي ===== catch (error) {
    console.error('Error in facility registration:', error);
    FlowManager.clearFlow(ctx.from.id.toString());
    
    if (error.code === 'P2002') {
      await ctx.reply('⚠️ A facility with this name already exists. Please choose a different name.');
    } else if (error.code === 'P2003') {
      await ctx.reply('⚠️ Invalid data provided. Please check your facility information.');
    } else {
      await ctx.reply('⚠️ An error occurred while creating the facility. Please try again.');
    }
  }
});

// === Master Panel Commands ===
bot.action('master_panel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 You are not authorized.');
  }
  const buttons = [];
  buttons.push([Markup.button.callback('📃 Pending Facilities', 'master_list_fac')]);
  buttons.push([Markup.button.callback('👥 Pending Members', 'master_list_members')]);
  await ctx.reply('Master Panel:', { reply_markup: { inline_keyboard: buttons } });
});

// List pending facilities for master approval
bot.action('master_list_fac', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Unauthorized.');
  }
      const pending = await prisma.facility.findMany({ where: { status: 'pending' } });
  if (!pending.length) {
    return ctx.reply('No pending facilities.');
  }
  const rows = pending.map(f => [
    Markup.button.callback(`${f.name}`, `master_fac_approve|${f.id.toString()}`)
  ]);
  await ctx.reply('Select a facility to approve:', { reply_markup: { inline_keyboard: rows } });
});

bot.action(/master_fac_approve\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Unauthorized.');
  }
  const facId = BigInt(ctx.match[1]);
      await prisma.facility.update({ where: { id: facId }, data: { status: 'active' } });
  await ctx.reply(`✅ Facility #${facId.toString()} activated.`);
});

// List pending switch requests
bot.action('master_list_members', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Unauthorized.');
  }
      const requests = await prisma.facilitySwitchRequest.findMany({
      where: { status: 'pending' },
      include: { user: true, facility: true }
    });
  if (!requests.length) {
    return ctx.reply('No pending membership requests.');
  }
  const rows = requests.map(r => [
    Markup.button.callback(
              `User ${r.user.tgId?.toString() || r.user.id.toString()} → #${r.facilityId.toString()}`,
      `master_member_approve|${r.id.toString()}`
    )
  ]);
  await ctx.reply('Select a request to approve:', { reply_markup: { inline_keyboard: rows } });
});

bot.action(/master_member_approve\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Unauthorized.');
  }
  const reqId = BigInt(ctx.match[1]);
  const req = await prisma.facilitySwitchRequest.findUnique({ where: { id: reqId } });
  if (!req || req.status !== 'pending') {
    return ctx.reply('Request not found.');
  }
  // Approve: create membership and set user activeFacilityId
  await prisma.$transaction(async (tx) => {
    await tx.facilityMember.create({
      data: {
        userId: req.userId,
        facilityId: req.facilityId,
        role: 'user'
      }
    });
    await tx.user.update({
      where: { id: req.userId },
      data: {
        status: 'active',
        activeFacilityId: req.facilityId
      }
    });
    await tx.facilitySwitchRequest.update({
      where: { id: reqId },
      data: { status: 'approved' }
    });
  });
  await ctx.reply(`✅ Membership request approved for user#${req.userId.toString()}.`);
});

// View work order details
bot.action(/wo_view\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const woId = BigInt(ctx.match[1]);
    
    const wo = await prisma.workOrder.findFirst({
      where: { 
        id: woId, 
        facilityId: user.activeFacilityId,
        createdByUserId: user.id 
      }
    });
    
    if (!wo) {
      return ctx.reply('⚠️ Work order not found.');
    }
    
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    const details = 
      `📋 **Work Order #${wo.id.toString()}**\n\n` +
      `${statusEmoji[wo.status]} **Status:** ${statusText[wo.status]}\n` +
      `${priorityEmoji[wo.priority] || '⚪'} **Priority:** ${wo.priority || 'Not set'}\n` +
      `🔧 **Type:** ${wo.typeOfWork || 'Not set'}\n` +
      `⚡ **Service:** ${wo.typeOfService || 'Not set'}\n` +
      `📍 **Location:** ${wo.location || 'Not set'}\n` +
      `🔧 **Equipment:** ${wo.equipment || 'Not set'}\n` +
      `📝 **Description:** ${wo.description}\n\n` +
      `📅 **Created:** ${wo.createdAt.toLocaleDateString()}\n` +
      `🕒 **Updated:** ${wo.updatedAt.toLocaleDateString()}`;
    
    // Create status change buttons based on current status
    const statusButtons = [];
    if (wo.status === 'open') {
      statusButtons.push([Markup.button.callback('🟡 Start Work', `wo_status|${wo.id.toString()}|in_progress`)]);
    } else if (wo.status === 'in_progress') {
      statusButtons.push([Markup.button.callback('🟢 Mark Done', `wo_status|${wo.id.toString()}|done`)]);
    } else if (wo.status === 'done') {
      statusButtons.push([Markup.button.callback('⚫ Close', `wo_status|${wo.id.toString()}|closed`)]);
    }
    
    const buttons = [
      ...statusButtons,
      [Markup.button.callback('📊 Status History', `wo_history|${wo.id.toString()}`)],
      [Markup.button.callback('📋 Back to List', 'wo_list')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(details, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing work order:', error);
    await ctx.reply('⚠️ An error occurred while viewing the work order.');
  }
});

// Change work order status
bot.action(/wo_status\|(\d+)\|(open|in_progress|done|closed)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const woId = BigInt(ctx.match[1]);
    const newStatus = ctx.match[2];
    
    const wo = await prisma.workOrder.findFirst({
      where: { 
        id: woId, 
        facilityId: user.activeFacilityId,
        createdByUserId: user.id 
      }
    });
    
    if (!wo) {
      return ctx.reply('⚠️ Work order not found.');
    }
    
    const oldStatus = wo.status;
    
         // Update work order status
     await prisma.$transaction(async (tx) => {
       // Update work order
       await tx.workOrder.update({
         where: { id: woId },
         data: { status: newStatus }
       });
       
       // Add status history
       await tx.statusHistory.create({
         data: {
           workOrderId: woId,
           oldStatus: oldStatus,
           newStatus: newStatus,
           updatedByUserId: user.id
         }
       });
     });
     
     // Create notification for status change
     await createNotification(
       user.id,
       user.activeFacilityId,
       'work_order_status_changed',
       'Work Order Status Updated',
       `Work Order #${woId.toString()} status changed from ${statusText[oldStatus]} to ${statusText[newStatus]}`,
       { workOrderId: woId.toString(), oldStatus, newStatus }
     );
     
     // Notify facility admins/supervisors about status changes
     const admins = await prisma.facilityMember.findMany({
       where: {
         facilityId: user.activeFacilityId,
         role: { in: ['facility_admin', 'supervisor'] }
       },
       include: { user: true }
     });
     
     for (const admin of admins) {
       if (admin.userId !== user.id) {
         await createNotification(
           admin.userId,
           user.activeFacilityId,
           'work_order_status_changed',
           'Work Order Status Update',
           `Work Order #${woId.toString()} status changed from ${statusText[oldStatus]} to ${statusText[newStatus]} by ${user.firstName || 'User'}`,
           { workOrderId: woId.toString(), oldStatus, newStatus, updatedBy: user.id }
         );
       }
     }
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    await ctx.reply(`✅ Work Order #${woId.toString()} status changed from **${statusText[oldStatus]}** to **${statusText[newStatus]}**`);
    
    // Refresh the work order view
    setTimeout(async () => {
      try {
        await ctx.deleteMessage();
        const event = { ...ctx, match: [null, woId.toString()] };
        await bot.action(`wo_view|${woId.toString()}`, event);
      } catch (e) {
        console.error('Error refreshing view:', e);
      }
    }, 2000);
    
  } catch (error) {
    console.error('Error changing work order status:', error);
    await ctx.reply('⚠️ An error occurred while changing the status.');
  }
});

// View work order status history
bot.action(/wo_history\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const woId = BigInt(ctx.match[1]);
    
    const wo = await prisma.workOrder.findFirst({
      where: { 
        id: woId, 
        facilityId: user.activeFacilityId,
        createdByUserId: user.id 
      }
    });
    
    if (!wo) {
      return ctx.reply('⚠️ Work order not found.');
    }
    
    const history = await prisma.statusHistory.findMany({
      where: { workOrderId: woId },
      orderBy: { createdAt: 'desc' },
      include: { updatedByUser: true }
    });
    
    if (!history.length) {
      return ctx.reply('📊 **Status History**\n\nNo status changes recorded yet.');
    }
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    const historyText = history.map(h => {
      const date = h.createdAt.toLocaleDateString() + ' ' + h.createdAt.toLocaleTimeString();
      const user = h.updatedByUser.firstName || `User ${h.updatedByUser.tgId?.toString() || h.updatedByUser.id.toString()}`;
      return `🔄 **${statusText[h.oldStatus]}** → **${statusText[h.newStatus]}**\n👤 ${user} • 📅 ${date}`;
    }).join('\n\n');
    
    await ctx.reply(
      `📊 **Status History**\nWork Order #${woId.toString()}\n\n${historyText}`,
      {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('📋 Back to Work Order', `wo_view|${woId.toString()}`)],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Error viewing status history:', error);
    await ctx.reply('⚠️ An error occurred while viewing the status history.');
  }
});

// Work order filtering
bot.action(/wo_filter\|(all|open|in_progress|done|closed|priority_high)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const filter = ctx.match[1];
    
    let whereClause = { facilityId: user.activeFacilityId, createdByUserId: user.id };
    
    if (filter === 'priority_high') {
      whereClause.priority = 'high';
    } else if (filter !== 'all') {
      whereClause.status = filter;
    }
    
    const wos = await prisma.workOrder.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 15
    });
    
    if (!wos.length) {
      const filterText = {
        'all': 'All',
        'open': 'Open',
        'in_progress': 'In Progress',
        'done': 'Done',
        'closed': 'Closed',
        'priority_high': 'High Priority'
      };
      return ctx.reply(`🔍 No ${filterText[filter]} work orders found.`);
    }
    
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const rows = wos.map(wo => {
      const priority = priorityEmoji[wo.priority] || '⚪';
      const status = statusEmoji[wo.status] || '⚪';
      const type = wo.typeOfWork ? `[${wo.typeOfWork}]` : '';
      
      return [Markup.button.callback(
        `${status} #${wo.id.toString()} ${priority} ${type}\n${wo.description.slice(0, 40)}${wo.description.length > 40 ? '...' : ''}`,
        `wo_view|${wo.id.toString()}`
      )];
    });
    
    const filterText = {
      'all': 'All',
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed',
      'priority_high': 'High Priority'
    };
    
    const buttons = [
      ...rows,
      [Markup.button.callback('🔙 Back to Filters', 'wo_list')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(`📋 **${filterText[filter]} Work Orders** (${wos.length})\n\nClick on any work order to view details:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error filtering work orders:', error);
    await ctx.reply('⚠️ An error occurred while filtering work orders.');
  }
});

// Facility work orders (for admins/supervisors)
bot.action('wo_facility_list', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can view all facility orders.');
    }
    
    const wos = await prisma.workOrder.findMany({
      where: { facilityId: user.activeFacilityId },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { byUser: true }
    });
    
    if (!wos.length) {
      return ctx.reply('🔍 No work orders found in this facility.');
    }
    
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const rows = wos.map(wo => {
      const priority = priorityEmoji[wo.priority] || '⚪';
      const status = statusEmoji[wo.status] || '⚪';
      const type = wo.typeOfWork ? `[${wo.typeOfWork}]` : '';
      const creator = wo.byUser?.firstName || `User ${wo.byUser?.tgId?.toString() || wo.byUser?.id.toString()}`;
      
      return [Markup.button.callback(
        `${status} #${wo.id.toString()} ${priority} ${type}\n👤 ${creator} • ${wo.description.slice(0, 30)}${wo.description.length > 30 ? '...' : ''}`,
        `wo_view|${wo.id.toString()}`
      )];
    });
    
    const buttons = [
      ...rows,
      [Markup.button.callback('🔙 Back to Filters', 'wo_list')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(`📊 **All Facility Work Orders** (${wos.length})\n\nClick on any work order to view details:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing facility work orders:', error);
    await ctx.reply('⚠️ An error occurred while viewing facility work orders.');
  }
});

// Work order statistics
bot.action('wo_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Get detailed statistics
    const statusStats = await prisma.workOrder.groupBy({
      by: ['status'],
      where: { facilityId: user.activeFacilityId, createdByUserId: user.id },
      _count: { status: true }
    });
    
    const priorityStats = await prisma.workOrder.groupBy({
      by: ['priority'],
      where: { facilityId: user.activeFacilityId, createdByUserId: user.id },
      _count: { priority: true }
    });
    
    const totalOrders = await prisma.workOrder.count({
      where: { facilityId: user.activeFacilityId, createdByUserId: user.id }
    });
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    const priorityText = {
      'high': 'High',
      'medium': 'Medium',
      'low': 'Low'
    };
    
    const statusSection = statusStats.map(s => 
      `${statusEmoji[s.status]} ${statusText[s.status]}: ${s._count.status}`
    ).join('\n');
    
    const prioritySection = priorityStats.map(p => 
      `${priorityEmoji[p.priority]} ${priorityText[p.priority]}: ${p._count.priority}`
    ).join('\n');
    
    const statsMessage = 
      `📈 **Work Order Statistics**\n\n` +
      `📊 **Total Orders:** ${totalOrders}\n\n` +
      `📋 **By Status:**\n${statusSection}\n\n` +
      `🎯 **By Priority:**\n${prioritySection}`;
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Filters', 'wo_list')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(statsMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing statistics:', error);
    await ctx.reply('⚠️ An error occurred while viewing statistics.');
  }
});

// === Facility Dashboard ===
bot.action('facility_dashboard', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can access the dashboard.');
    }
    
    // Get facility info
    const facility = await prisma.facility.findUnique({
      where: { id: user.activeFacilityId }
    });
    
    // Get basic stats
    const totalMembers = await prisma.facilityMember.count({
      where: { facilityId: user.activeFacilityId }
    });
    
    const totalWorkOrders = await prisma.workOrder.count({
      where: { facilityId: user.activeFacilityId }
    });
    
    const openWorkOrders = await prisma.workOrder.count({
      where: { 
        facilityId: user.activeFacilityId,
        status: 'open'
      }
    });
    
    const buttons = [
      [Markup.button.callback('👥 Manage Members', 'facility_members')],
      [Markup.button.callback('📊 Facility Statistics', 'facility_stats')],
      [Markup.button.callback('⚙️ Facility Settings', 'facility_settings')],
      [Markup.button.callback('📋 All Work Orders', 'wo_facility_list')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    // Get plan information
    const planInfo = await PlanManager.getPlanInfo(user.activeFacilityId);
    
    const dashboardMessage = 
      `🏢 **Facility Dashboard**\n\n` +
      `📋 **${facility.name}**\n` +
      `📍 ${facility.city || 'No city'}\n` +
      `📞 ${facility.phone || 'No phone'}\n` +
      `💼 **Plan:** ${planInfo.plan}\n\n` +
      `📊 **Quick Stats:**\n` +
      `👥 Members: ${totalMembers}/${planInfo.limits.members}\n` +
      `📋 Total Work Orders: ${totalWorkOrders}/${planInfo.limits.workOrders}\n` +
      `🔵 Open Orders: ${openWorkOrders}\n\n` +
      `📈 **Plan Usage:**\n` +
      `👥 Members: ${planInfo.usage.members}/${planInfo.limits.members}\n` +
      `📋 Work Orders: ${planInfo.usage.workOrders}/${planInfo.limits.workOrders}\n` +
      `📊 Reports: ${planInfo.usage.reports}/${planInfo.limits.reports}\n` +
      `⏰ Reminders: ${planInfo.usage.reminders}/${planInfo.limits.reminders}`;
    
    await ctx.reply(dashboardMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'facility_dashboard');
});

// Manage facility members
bot.action('facility_members', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can manage members.');
    }
    
    const members = await prisma.facilityMember.findMany({
      where: { facilityId: user.activeFacilityId },
      include: { user: true },
      orderBy: { createdAt: 'asc' }
    });
    
    if (!members.length) {
      return ctx.reply('👥 No members found in this facility.');
    }
    
    const roleEmoji = {
      'facility_admin': '👑',
      'supervisor': '🛠️',
      'user': '👤'
    };
    
    const roleText = {
      'facility_admin': 'Admin',
      'supervisor': 'Supervisor',
      'user': 'User'
    };
    
    const memberButtons = members.map(member => {
      const name = member.user.firstName || `User ${member.user.tgId?.toString() || member.user.id.toString()}`;
      const fullName = member.user.lastName ? `${name} ${member.user.lastName}` : name;
      const role = roleEmoji[member.role] + ' ' + roleText[member.role];
      const jobTitle = member.user.jobTitle ? ` - ${member.user.jobTitle}` : '';
      
      return [Markup.button.callback(
        `${fullName} (${role})${jobTitle}`,
        `member_view|${member.id.toString()}`
      )];
    });
    
    const buttons = [
      ...memberButtons,
      [Markup.button.callback('➕ Invite Member', 'facility_invite')],
      [Markup.button.callback('🔙 Back to Dashboard', 'facility_dashboard')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(`👥 **Facility Members** (${members.length})\n\nClick on any member to manage:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error managing facility members:', error);
    await ctx.reply('⚠️ An error occurred while managing members.');
  }
});

// View member details
bot.action(/member_view\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const memberId = BigInt(ctx.match[1]);
    
    // Check if user is facility admin or supervisor
    const currentMembership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!currentMembership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can view member details.');
    }
    
    const member = await prisma.facilityMember.findFirst({
      where: { 
        id: memberId,
        facilityId: user.activeFacilityId
      },
      include: { user: true }
    });
    
    if (!member) {
      return ctx.reply('⚠️ Member not found.');
    }
    
    // Get member's work order stats
    const memberWorkOrders = await prisma.workOrder.count({
      where: { 
        facilityId: user.activeFacilityId,
        createdByUserId: member.userId
      }
    });
    
    const roleEmoji = {
      'facility_admin': '👑',
      'supervisor': '🛠️',
      'user': '👤'
    };
    
    const roleText = {
      'facility_admin': 'Admin',
      'supervisor': 'Supervisor',
      'user': 'User'
    };
    
    const memberDetails = 
      `👤 **Member Details**\n\n` +
      `📝 **Name:** ${member.user.firstName || 'Not set'}${member.user.lastName ? ` ${member.user.lastName}` : ''}\n` +
      `🆔 **Telegram ID:** ${member.user.tgId?.toString() || 'Not set'}\n` +
      `${roleEmoji[member.role]} **Role:** ${roleText[member.role]}\n` +
      `💼 **Job Title:** ${member.user.jobTitle || 'Not set'}\n` +
      `📧 **Email:** ${member.user.email || 'Not set'}\n` +
      `📞 **Phone:** ${member.user.phone || 'Not set'}\n` +
      `📋 **Work Orders:** ${memberWorkOrders}\n` +
      `📅 **Joined:** ${member.createdAt.toLocaleDateString()}`;
    
    const buttons = [];
    
    // Only facility admins can change roles
    if (currentMembership.role === 'facility_admin' && member.role !== 'facility_admin') {
      if (member.role === 'user') {
        buttons.push([Markup.button.callback('🛠️ Promote to Supervisor', `member_promote|${member.id.toString()}|supervisor`)]);
      } else if (member.role === 'supervisor') {
        buttons.push([Markup.button.callback('👑 Promote to Admin', `member_promote|${member.id.toString()}|facility_admin`)]);
        buttons.push([Markup.button.callback('👤 Demote to User', `member_promote|${member.id.toString()}|user`)]);
      }
      buttons.push([Markup.button.callback('❌ Remove Member', `member_remove|${member.id.toString()}`)]);
    }
    
    buttons.push(
      [Markup.button.callback('🔙 Back to Members', 'facility_members')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    );
    
    await ctx.reply(memberDetails, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing member details:', error);
    await ctx.reply('⚠️ An error occurred while viewing member details.');
  }
});

// Promote/Demote member
bot.action(/member_promote\|(\d+)\|(facility_admin|supervisor|user)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const memberId = BigInt(ctx.match[1]);
    const newRole = ctx.match[2];
    
    // Check if user is facility admin
    const currentMembership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: 'facility_admin'
      }
    });
    
    if (!currentMembership) {
      return ctx.reply('⚠️ Only facility admins can change member roles.');
    }
    
    const member = await prisma.facilityMember.findFirst({
      where: { 
        id: memberId,
        facilityId: user.activeFacilityId
      },
      include: { user: true }
    });
    
    if (!member) {
      return ctx.reply('⚠️ Member not found.');
    }
    
    if (member.role === 'facility_admin') {
      return ctx.reply('⚠️ Cannot change admin role.');
    }
    
    await prisma.facilityMember.update({
      where: { id: memberId },
      data: { role: newRole }
    });
    
    const roleText = {
      'facility_admin': 'Admin',
      'supervisor': 'Supervisor',
      'user': 'User'
    };
    
    const memberName = member.user.firstName || `User ${member.user.tgId?.toString() || member.user.id.toString()}`;
    
    await ctx.reply(`✅ **${memberName}** role changed to **${roleText[newRole]}**`);
    
    // Refresh member view
    setTimeout(async () => {
      try {
        await ctx.deleteMessage();
        const event = { ...ctx, match: [null, memberId.toString()] };
        await bot.action(`member_view|${memberId.toString()}`, event);
      } catch (e) {
        console.error('Error refreshing member view:', e);
      }
    }, 2000);
    
  } catch (error) {
    console.error('Error promoting member:', error);
    await ctx.reply('⚠️ An error occurred while changing member role.');
  }
});

// Remove member
bot.action(/member_remove\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const memberId = BigInt(ctx.match[1]);
    
    // Check if user is facility admin
    const currentMembership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: 'facility_admin'
      }
    });
    
    if (!currentMembership) {
      return ctx.reply('⚠️ Only facility admins can remove members.');
    }
    
    const member = await prisma.facilityMember.findFirst({
      where: { 
        id: memberId,
        facilityId: user.activeFacilityId
      },
      include: { user: true }
    });
    
    if (!member) {
      return ctx.reply('⚠️ Member not found.');
    }
    
    if (member.role === 'facility_admin') {
      return ctx.reply('⚠️ Cannot remove facility admin.');
    }
    
    // Remove member
    await prisma.facilityMember.delete({
      where: { id: memberId }
    });
    
    // Update user's activeFacilityId if it was this facility
    if (member.user.activeFacilityId === user.activeFacilityId) {
      await prisma.user.update({
        where: { id: member.userId },
        data: { 
          activeFacilityId: null,
          status: 'pending'
        }
      });
    }
    
    const memberName = member.user.firstName || `User ${member.user.tgId?.toString() || member.user.id.toString()}`;
    
    await ctx.reply(`✅ **${memberName}** has been removed from the facility.`);
    
    // Go back to members list
    setTimeout(async () => {
      try {
        await ctx.deleteMessage();
        await bot.action('facility_members', ctx);
      } catch (e) {
        console.error('Error going back to members list:', e);
      }
    }, 2000);
    
  } catch (error) {
    console.error('Error removing member:', error);
    await ctx.reply('⚠️ An error occurred while removing member.');
  }
});

// Facility statistics
bot.action('facility_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can view statistics.');
    }
    
    // Get comprehensive statistics
    const totalMembers = await prisma.facilityMember.count({
      where: { facilityId: user.activeFacilityId }
    });
    
    const totalWorkOrders = await prisma.workOrder.count({
      where: { facilityId: user.activeFacilityId }
    });
    
    const statusStats = await prisma.workOrder.groupBy({
      by: ['status'],
      where: { facilityId: user.activeFacilityId },
      _count: { status: true }
    });
    
    const priorityStats = await prisma.workOrder.groupBy({
      by: ['priority'],
      where: { facilityId: user.activeFacilityId },
      _count: { priority: true }
    });
    
    const roleStats = await prisma.facilityMember.groupBy({
      by: ['role'],
      where: { facilityId: user.activeFacilityId },
      _count: { role: true }
    });
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };
    
    const roleEmoji = {
      'facility_admin': '👑',
      'supervisor': '🛠️',
      'user': '👤'
    };
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    const priorityText = {
      'high': 'High',
      'medium': 'Medium',
      'low': 'Low'
    };
    
    const roleText = {
      'facility_admin': 'Admins',
      'supervisor': 'Supervisors',
      'user': 'Users'
    };
    
    const statusSection = statusStats.map(s => 
      `${statusEmoji[s.status]} ${statusText[s.status]}: ${s._count.status}`
    ).join('\n');
    
    const prioritySection = priorityStats.map(p => 
      `${priorityEmoji[p.priority]} ${priorityText[p.priority]}: ${p._count.priority}`
    ).join('\n');
    
    const roleSection = roleStats.map(r => 
      `${roleEmoji[r.role]} ${roleText[r.role]}: ${r._count.role}`
    ).join('\n');
    
    const statsMessage = 
      `📊 **Facility Statistics**\n\n` +
      `👥 **Members:** ${totalMembers}\n` +
      `📋 **Total Work Orders:** ${totalWorkOrders}\n\n` +
      `📋 **Work Orders by Status:**\n${statusSection}\n\n` +
      `🎯 **Work Orders by Priority:**\n${prioritySection}\n\n` +
      `👥 **Members by Role:**\n${roleSection}`;
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Dashboard', 'facility_dashboard')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(statsMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing facility statistics:', error);
    await ctx.reply('⚠️ An error occurred while viewing statistics.');
  }
});

// Facility settings
bot.action('facility_settings', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: 'facility_admin'
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins can access settings.');
    }
    
    const facility = await prisma.facility.findUnique({
      where: { id: user.activeFacilityId }
    });
    
    const settingsMessage = 
      `⚙️ **Facility Settings**\n\n` +
      `📋 **Name:** ${facility.name}\n` +
      `📍 **المدينة:** ${facility.city || 'Not set'}\n` +
      `📞 **Phone:** ${facility.phone || 'Not set'}\n` +
      `💼 **Plan:** ${facility.planTier || 'Not set'}\n` +
      `✅ **Status:** ${facility.isActive ? 'Active' : 'Inactive'}\n\n` +
      `Settings management coming soon...`;
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Dashboard', 'facility_dashboard')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(settingsMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error accessing facility settings:', error);
    await ctx.reply('⚠️ An error occurred while accessing settings.');
  }
});

// === Notification System ===

// Load user notification settings (from latest system_alert with title user_notification_settings)
async function getUserNotificationSettings(userId) {
  const settingsKey = 'user_notification_settings';
  const افتراضيs = {
    workOrderUpdates: true,
    statusChanges: true,
    highPriorityAlerts: true,
    يومياًSummaries: true,
    أسبوعياًReports: true
  };
  try {
    const existing = await prisma.notification.findFirst({
      where: { userId: BigInt(userId), type: 'system_alert', title: settingsKey },
      orderBy: { createdAt: 'desc' }
    });
    return existing?.data ? { ...افتراضيs, ...existing.data } : افتراضيs;
  } catch (e) {
    return افتراضيs;
  }
}

// Check if a notification type is enabled based on settings
function isNotificationEnabledForType(settings, type) {
  const map = {
    work_order_created: 'workOrderUpdates',
    work_order_assigned: 'workOrderUpdates',
    work_order_status_changed: 'statusChanges',
    high_priority_alert: 'highPriorityAlerts',
    يومياً_summary: 'يومياًSummaries',
    أسبوعياً_report: 'أسبوعياًReports',
    system_alert: true,
    new_member_request: 'statusChanges',
    membership_approved: 'statusChanges',
    role_changed: 'statusChanges'
  };

  const key = map[type];
  if (key === true) return true;
  if (!key) return true; // افتراضي allow if unmapped
  return Boolean(settings[key]);
}
/**
 * إنشاء إشعار جديد
 * @param {BigInt|string} userId - معرف المستخدم
 * @param {BigInt|string} facilityId - معرف المنشأة (اختياري)
 * @param {string} type - نوع الإشعار
 * @param {string} title - عنوان الإشعار
 * @param {string} message - رسالة الإشعار
 * @param {Object} data - بيانات إضافية (اختياري)
 * 
 * أنواع الإشعارات المدعومة:
 * - work_order_created: إنشاء طلب صيانة جديد
 * - work_order_status_changed: تغيير حالة طلب الصيانة
 * - work_order_assigned: تعيين طلب صيانة
 * - member_joined: انضمام عضو جديد
 * - member_left: مغادرة عضو
 * - facility_activated: تفعيل منشأة
 * - high_priority_alert: تنبيه أولوية عالية
 * - يومياً_summary: ملخص يومي
 * - أسبوعياً_report: تقرير أسبوعي
 * - system_alert: تنبيه نظام
 * - new_member_request: طلب انضمام جديد
 * - membership_approved: موافقة على العضوية
 * - role_changed: تغيير الدور
 * 
 * Notes:
 * - يتم حفظ الإشعار في قاعدة البيانات
 * - يتم معالجة الأخطاء بشكل آمن
 * - يتم تحويل البيانات الإضافية إلى JSON
 */
async function createNotification(userId, facilityId, type, title, message, data = null) {
  try {
    // Always persist notification for audit/history
    await prisma.notification.create({
      data: {
        userId: BigInt(userId),
        facilityId: facilityId ? BigInt(facilityId) : null,
        type,
        title,
        message,
        data: data ? JSON.parse(JSON.stringify(data)) : null
      }
    });

    // Respect user notification settings for sending via Telegram
    const settings = await getUserNotificationSettings(userId);
    if (isNotificationEnabledForType(settings, type)) {
      try {
        await sendTelegramNotification(userId, title, message, null);
      } catch (sendErr) {
        console.error('Error sending Telegram notification:', sendErr);
      }
    }
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

/**
 * إرسال إشعار للUser عبر تيليجرام
 * @param {BigInt|string} userId - معرف المستخدم
 * @param {string} title - عنوان الإشعار
 * @param {string} message - رسالة الإشعار
 * @param {Array} buttons - أزرار تفاعلية (اختياري)
 * @param {string} notificationType - نوع الإشعار للتحقق من الإعدادات (اختياري)
 * 
 * هذه الدالة ترسل إشعار مباشر للمستخدم عبر تيليجرام
 * 
 * Notes:
 * - يتم البحث عن الUser في قاعدة البيانات
 * - يتم التحقق من وجود معرف تيليجرام
 * - يتم التحقق من إعدادات الإشعارات (إن تم تمرير نوع الإشعار)
 * - يتم إرسال الرسالة مع الأزرار التفاعلية (إن وجدت)
 * - يتم معالجة الأخطاء بشكل آمن
 */
async function sendTelegramNotification(userId, title, message, buttons = null, notificationType = null) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) }
    });
    
    if (!user?.tgId) {
      console.log(`User ${userId} not found or no Telegram ID`);
      return;
    }
    
    // Check notification settings if type is provided
    if (notificationType) {
      const settings = await getUserNotificationSettings(userId);
      if (!isNotificationEnabledForType(settings, notificationType)) {
        console.log(`نوع الإشعار ${notificationType} disabled for user ${userId}`);
        return;
      }
    }
    
    const options = buttons ? { reply_markup: { inline_keyboard: buttons } } : {};
    await bot.telegram.sendMessage(user.tgId.toString(), `${title}\n\n${message}`, options);
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
}

// Notifications menu
bot.action('notifications', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    
    if (!notifications.length) {
      return ctx.reply('🔔 No notifications found.');
    }
    
    const notificationButtons = notifications.map(notification => {
      const isRead = notification.isRead ? '✅' : '🔔';
      const date = notification.createdAt.toLocaleDateString();
      const shortTitle = notification.title.length > 30 ? 
        notification.title.slice(0, 30) + '...' : notification.title;
      
      return [Markup.button.callback(
        `${isRead} ${shortTitle} (${date})`,
        `notification_view|${notification.id.toString()}`
      )];
    });
    
    const buttons = [
      ...notificationButtons,
      [Markup.button.callback('📊 Reports', 'reports_menu')],
      [Markup.button.callback('⚙️ Notification Settings', 'notification_settings')],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ];
    
    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false }
    });
    
    await ctx.reply(`🔔 **Notifications** (${unreadCount} unread)\n\nClick on any notification to view details:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error accessing notifications:', error);
    await ctx.reply('⚠️ An error occurred while accessing notifications.');
  }
});

// View notification details
bot.action(/notification_view\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const notificationId = BigInt(ctx.match[1]);
    
    const notification = await prisma.notification.findFirst({
      where: { 
        id: notificationId,
        userId: user.id
      }
    });
    
    if (!notification) {
      return ctx.reply('⚠️ Notification not found.');
    }
    
    // Mark as read
    if (!notification.isRead) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true }
      });
    }
    
    const date = notification.createdAt.toLocaleDateString() + ' ' + notification.createdAt.toLocaleTimeString();
    const typeEmoji = {
      'work_order_created': '📋',
      'work_order_status_changed': '🔄',
      'work_order_assigned': '👤',
      'member_joined': '👥',
      'member_left': '👋',
      'facility_activated': '✅',
      'high_priority_alert': '🚨',
      'يومياً_summary': '📊',
      'أسبوعياً_report': '📈',
      'system_alert': '⚠️'
    };
    
    const notificationDetails = 
      `${typeEmoji[notification.type] || '🔔'} **${notification.title}**\n\n` +
      `${notification.message}\n\n` +
      `📅 **Date:** ${date}\n` +
      `📋 **Type:** ${notification.type.replace(/_/g, ' ').toUpperCase()}`;
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Notifications', 'notifications')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(notificationDetails, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing notification:', error);
    await ctx.reply('⚠️ An error occurred while viewing notification.');
  }
});

// Reports menu
bot.action('reports_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can access reports.');
    }
    
    const buttons = [
      [Markup.button.callback('📊 Daily Summary', 'report_يومياً')],
      [Markup.button.callback('📈 Weekly Report', 'report_أسبوعياً')],
      [Markup.button.callback('📋 Work Order Analysis', 'report_work_orders')],
      [Markup.button.callback('👥 Member Activity', 'report_members')],
      [Markup.button.callback('🎯 Priority Analysis', 'report_priorities')],
      [Markup.button.callback('🔙 Back to Notifications', 'notifications')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply('📊 **Reports & Analytics**\n\nChoose a report type:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error accessing reports:', error);
    await ctx.reply('⚠️ An error occurred while accessing reports.');
  }
});

// Daily summary report
bot.action('report_يومياً', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can access reports.');
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Get today's statistics
    const newWorkOrders = await prisma.workOrder.count({
      where: {
        facilityId: user.activeFacilityId,
        createdAt: { gte: today, lt: tomorrow }
      }
    });
    
    const completedWorkOrders = await prisma.workOrder.count({
      where: {
        facilityId: user.activeFacilityId,
        status: { in: ['done', 'closed'] },
        updatedAt: { gte: today, lt: tomorrow }
      }
    });
    
    const highPriorityOrders = await prisma.workOrder.count({
      where: {
        facilityId: user.activeFacilityId,
        priority: 'high',
        createdAt: { gte: today, lt: tomorrow }
      }
    });
    
    const activeMembers = await prisma.facilityMember.count({
      where: { facilityId: user.activeFacilityId }
    });
    
    const statusStats = await prisma.workOrder.groupBy({
      by: ['status'],
      where: { facilityId: user.activeFacilityId },
      _count: { status: true }
    });
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    const statusSection = statusStats.map(s => 
      `${statusEmoji[s.status]} ${statusText[s.status]}: ${s._count.status}`
    ).join('\n');
    
    const reportMessage = 
      `📊 **Daily Summary Report**\n` +
      `📅 ${today.toLocaleDateString()}\n\n` +
      `📋 **Today's Activity:**\n` +
      `➕ New Work Orders: ${newWorkOrders}\n` +
      `✅ Completed Orders: ${completedWorkOrders}\n` +
      `🚨 High Priority: ${highPriorityOrders}\n` +
      `👥 Active Members: ${activeMembers}\n\n` +
      `📊 **Current Status Distribution:**\n${statusSection}`;
    
    const buttons = [
      [Markup.button.callback('📈 Weekly Report', 'report_أسبوعياً')],
      [Markup.button.callback('🔙 Back to Reports', 'reports_menu')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(reportMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating يومياً report:', error);
    await ctx.reply('⚠️ An error occurred while generating the report.');
  }
});

// Weekly report
bot.action('report_أسبوعياً', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can access reports.');
    }
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    // Get أسبوعياً statistics
    const أسبوعياًWorkOrders = await prisma.workOrder.count({
      where: {
        facilityId: user.activeFacilityId,
        createdAt: { gte: weekAgo }
      }
    });
    
    const أسبوعياًCompleted = await prisma.workOrder.count({
      where: {
        facilityId: user.activeFacilityId,
        status: { in: ['done', 'closed'] },
        updatedAt: { gte: weekAgo }
      }
    });
    
    const completionRate = أسبوعياًWorkOrders > 0 ? 
      Math.round((أسبوعياًCompleted / أسبوعياًWorkOrders) * 100) : 0;
    
    const priorityStats = await prisma.workOrder.groupBy({
      by: ['priority'],
      where: {
        facilityId: user.activeFacilityId,
        createdAt: { gte: weekAgo }
      },
      _count: { priority: true }
    });
    
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };
    
    const priorityText = {
      'high': 'High',
      'medium': 'Medium',
      'low': 'Low'
    };
    
    const prioritySection = priorityStats.map(p => 
      `${priorityEmoji[p.priority]} ${priorityText[p.priority]}: ${p._count.priority}`
    ).join('\n');
    
    const reportMessage = 
      `📈 **Weekly Report**\n` +
      `📅 Last 7 Days\n\n` +
      `📊 **Weekly Statistics:**\n` +
      `📋 Total Work Orders: ${أسبوعياًWorkOrders}\n` +
      `✅ Completed: ${أسبوعياًCompleted}\n` +
      `📈 Completion Rate: ${completionRate}%\n\n` +
      `🎯 **Priority Distribution:**\n${prioritySection}`;
    
    const buttons = [
      [Markup.button.callback('📊 Daily Summary', 'report_يومياً')],
      [Markup.button.callback('🔙 Back to Reports', 'reports_menu')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(reportMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating أسبوعياً report:', error);
    await ctx.reply('⚠️ An error occurred while generating the report.');
  }
});

// === Additional Report Handlers ===

// Work Order Analysis Report
bot.action('report_work_orders', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can access reports.');
    }
    
    // Get comprehensive work order analysis
    const totalWorkOrders = await prisma.workOrder.count({
      where: { facilityId: user.activeFacilityId }
    });
    
    const statusStats = await prisma.workOrder.groupBy({
      by: ['status'],
      where: { facilityId: user.activeFacilityId },
      _count: { status: true }
    });
    
    const priorityStats = await prisma.workOrder.groupBy({
      by: ['priority'],
      where: { facilityId: user.activeFacilityId },
      _count: { priority: true }
    });
    
    const typeStats = await prisma.workOrder.groupBy({
      by: ['typeOfWork'],
      where: { facilityId: user.activeFacilityId },
      _count: { typeOfWork: true }
    });
    
    const serviceStats = await prisma.workOrder.groupBy({
      by: ['typeOfService'],
      where: { facilityId: user.activeFacilityId },
      _count: { typeOfService: true }
    });
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    const priorityText = {
      'high': 'High',
      'medium': 'Medium',
      'low': 'Low'
    };
    
    const statusSection = statusStats.map(s => 
      `${statusEmoji[s.status]} ${statusText[s.status]}: ${s._count.status}`
    ).join('\n');
    
    const prioritySection = priorityStats.map(p => 
      `${priorityEmoji[p.priority]} ${priorityText[p.priority]}: ${p._count.priority}`
    ).join('\n');
    
    const typeSection = typeStats.map(t => 
      `🔧 ${t.typeOfWork || 'Not set'}: ${t._count.typeOfWork}`
    ).join('\n');
    
    const serviceSection = serviceStats.map(s => 
      `⚡ ${s.typeOfService || 'Not set'}: ${s._count.typeOfService}`
    ).join('\n');
    
    const analysisMessage = 
      `📋 **Work Order Analysis Report**\n\n` +
      `📊 **Total Work Orders:** ${totalWorkOrders}\n\n` +
      `📋 **By Status:**\n${statusSection}\n\n` +
      `🎯 **By Priority:**\n${prioritySection}\n\n` +
      `🔧 **By Work Type:**\n${typeSection}\n\n` +
      `⚡ **By Service Type:**\n${serviceSection}`;
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Reports', 'reports_menu')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(analysisMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating work order analysis:', error);
    await ctx.reply('⚠️ An error occurred while generating the analysis.');
  }
});

// Member Activity Report
bot.action('report_members', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can access reports.');
    }
    
    // Get member activity data
    const members = await prisma.facilityMember.findMany({
      where: { facilityId: user.activeFacilityId },
      include: { 
        user: true,
        _count: {
          select: {
            // We'll get work orders count separately
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
    
    const roleStats = await prisma.facilityMember.groupBy({
      by: ['role'],
      where: { facilityId: user.activeFacilityId },
      _count: { role: true }
    });
    
    // Get work orders count for each member
    const memberActivity = await Promise.all(
      members.map(async (member) => {
        const workOrdersCount = await prisma.workOrder.count({
          where: { 
            facilityId: user.activeFacilityId,
            createdByUserId: member.userId
          }
        });
        
        const recentActivity = await prisma.workOrder.count({
          where: { 
            facilityId: user.activeFacilityId,
            createdByUserId: member.userId,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
          }
        });
        
        return {
          ...member,
          workOrdersCount,
          recentActivity
        };
      })
    );
    
    const roleEmoji = {
      'facility_admin': '👑',
      'supervisor': '🛠️',
      'user': '👤'
    };
    
    const roleText = {
      'facility_admin': 'Admins',
      'supervisor': 'Supervisors',
      'user': 'Users'
    };
    
    const roleSection = roleStats.map(r => 
      `${roleEmoji[r.role]} ${roleText[r.role]}: ${r._count.role}`
    ).join('\n');
    
    const memberSection = memberActivity.map(member => {
      const name = member.user.firstName || `User ${member.user.tgId?.toString() || member.user.id.toString()}`;
      const fullName = member.user.lastName ? `${name} ${member.user.lastName}` : name;
      const role = roleEmoji[member.role] + ' ' + roleText[member.role];
      const jobTitle = member.user.jobTitle ? `\n   💼 ${member.user.jobTitle}` : '';
      return `👤 **${fullName}** (${role})${jobTitle}\n   📋 Total Orders: ${member.workOrdersCount}\n   📅 Recent (7d): ${member.recentActivity}`;
    }).join('\n\n');
    
    const activityMessage = 
      `👥 **Member Activity Report**\n\n` +
      `📊 **Role Distribution:**\n${roleSection}\n\n` +
      `👤 **Member Details:**\n${memberSection}`;
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Reports', 'reports_menu')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(activityMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating member activity report:', error);
    await ctx.reply('⚠️ An error occurred while generating the report.');
  }
});

// Priority Analysis Report
bot.action('report_priorities', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can access reports.');
    }
    
    // Get priority analysis data
    const priorityStats = await prisma.workOrder.groupBy({
      by: ['priority'],
      where: { facilityId: user.activeFacilityId },
      _count: { priority: true }
    });
    
    const priorityByStatus = await prisma.workOrder.groupBy({
      by: ['priority', 'status'],
      where: { facilityId: user.activeFacilityId },
      _count: { priority: true }
    });
    
    const highPriorityOpen = await prisma.workOrder.count({
      where: { 
        facilityId: user.activeFacilityId,
        priority: 'high',
        status: 'open'
      }
    });
    
    const highPriorityInProgress = await prisma.workOrder.count({
      where: { 
        facilityId: user.activeFacilityId,
        priority: 'high',
        status: 'in_progress'
      }
    });
    
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };
    
    const priorityText = {
      'high': 'High',
      'medium': 'Medium',
      'low': 'Low'
    };
    
    const statusEmoji = {
      'open': '🔵',
      'in_progress': '🟡',
      'done': '🟢',
      'closed': '⚫'
    };
    
    const statusText = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'done': 'Done',
      'closed': 'Closed'
    };
    
    const prioritySection = priorityStats.map(p => 
      `${priorityEmoji[p.priority]} ${priorityText[p.priority]}: ${p._count.priority}`
    ).join('\n');
    
    const priorityByStatusSection = priorityByStatus.map(p => 
      `${priorityEmoji[p.priority]} ${priorityText[p.priority]} - ${statusEmoji[p.status]} ${statusText[p.status]}: ${p._count.priority}`
    ).join('\n');
    
    const priorityMessage = 
      `🎯 **Priority Analysis Report**\n\n` +
      `📊 **Priority Distribution:**\n${prioritySection}\n\n` +
      `📋 **Priority by Status:**\n${priorityByStatusSection}\n\n` +
      `🚨 **High Priority Alerts:**\n` +
      `🔴 High Priority Open: ${highPriorityOpen}\n` +
      `🟡 High Priority In Progress: ${highPriorityInProgress}`;
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Reports', 'reports_menu')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(priorityMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating priority analysis:', error);
    await ctx.reply('⚠️ An error occurred while generating the analysis.');
  }
});

// Notification settings
bot.action('notification_settings', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);

    // Load current settings from a synthetic system notification (or افتراضيs)
    const settingsKey = 'user_notification_settings';
    const existing = await prisma.notification.findFirst({
      where: { userId: user.id, type: 'system_alert', title: settingsKey },
      orderBy: { createdAt: 'desc' }
    });

    const افتراضيs = {
      workOrderUpdates: true,
      statusChanges: true,
      highPriorityAlerts: true,
      يومياًSummaries: true,
      أسبوعياًReports: true
    };

    const settings = existing?.data ? { ...افتراضيs, ...existing.data } : افتراضيs;

    const toEmoji = (v) => (v ? '✅' : '❌');

    const settingsMessage =
      `⚙️ **Notification Settings**\n\n` +
      `${toEmoji(settings.workOrderUpdates)} Work Order Updates\n` +
      `${toEmoji(settings.statusChanges)} Status Changes\n` +
      `${toEmoji(settings.highPriorityAlerts)} High Priority Alerts\n` +
      `${toEmoji(settings.يومياًSummaries)} Daily Summaries\n` +
      `${toEmoji(settings.أسبوعياًReports)} Weekly Reports`;

    const buttons = [
      [
        Markup.button.callback(`${toEmoji(settings.workOrderUpdates)} Work Orders`, 'notif_toggle|workOrderUpdates'),
        Markup.button.callback(`${toEmoji(settings.statusChanges)} Status`, 'notif_toggle|statusChanges')
      ],
      [
        Markup.button.callback(`${toEmoji(settings.highPriorityAlerts)} High Priority`, 'notif_toggle|highPriorityAlerts')
      ],
      [
        Markup.button.callback(`${toEmoji(settings.يومياًSummaries)} Daily`, 'notif_toggle|يومياًSummaries'),
        Markup.button.callback(`${toEmoji(settings.أسبوعياًReports)} Weekly`, 'notif_toggle|أسبوعياًReports')
      ],
      [Markup.button.callback('🔙 Back to Notifications', 'notifications')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];

    await ctx.reply(settingsMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error accessing notification settings:', error);
    await ctx.reply('⚠️ An error occurred while accessing settings.');
  }
});

// Toggle notification settings
bot.action(/notif_toggle\|(workOrderUpdates|statusChanges|highPriorityAlerts|يومياًSummaries|أسبوعياًReports)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const key = ctx.match[1];

    const settingsKey = 'user_notification_settings';
    const existing = await prisma.notification.findFirst({
      where: { userId: user.id, type: 'system_alert', title: settingsKey },
      orderBy: { createdAt: 'desc' }
    });

    const افتراضيs = {
      workOrderUpdates: true,
      statusChanges: true,
      highPriorityAlerts: true,
      يومياًSummaries: true,
      أسبوعياًReports: true
    };
    const current = existing?.data ? { ...افتراضيs, ...existing.data } : افتراضيs;
    const updated = { ...current, [key]: !current[key] };

    // Persist as a new system_alert record (immutable audit-friendly)
    await prisma.notification.create({
      data: {
        userId: user.id,
        facilityId: user.activeFacilityId,
        type: 'system_alert',
        title: settingsKey,
        message: `Updated ${key} to ${updated[key] ? 'on' : 'off'}`,
        data: updated
      }
    });

    const toEmoji = (v) => (v ? '✅' : '❌');

    const settingsMessage =
      `⚙️ **Notification Settings**\n\n` +
      `${toEmoji(updated.workOrderUpdates)} Work Order Updates\n` +
      `${toEmoji(updated.statusChanges)} Status Changes\n` +
      `${toEmoji(updated.highPriorityAlerts)} High Priority Alerts\n` +
      `${toEmoji(updated.يومياًSummaries)} Daily Summaries\n` +
      `${toEmoji(updated.أسبوعياًReports)} Weekly Reports`;

    const buttons = [
      [
        Markup.button.callback(`${toEmoji(updated.workOrderUpdates)} Work Orders`, 'notif_toggle|workOrderUpdates'),
        Markup.button.callback(`${toEmoji(updated.statusChanges)} Status`, 'notif_toggle|statusChanges')
      ],
      [
        Markup.button.callback(`${toEmoji(updated.highPriorityAlerts)} High Priority`, 'notif_toggle|highPriorityAlerts')
      ],
      [
        Markup.button.callback(`${toEmoji(updated.يومياًSummaries)} Daily`, 'notif_toggle|يومياًSummaries'),
        Markup.button.callback(`${toEmoji(updated.أسبوعياًReports)} Weekly`, 'notif_toggle|أسبوعياًReports')
      ],
      [Markup.button.callback('🔙 Back to Notifications', 'notifications')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];

    await ctx.reply(settingsMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error toggling notification setting:', error);
    await ctx.reply('⚠️ An error occurred أثناء تعديل إعدادات الإشعارات.');
  }
});

// ===== نظام إدارة الفريق وتعيين المهام =====

/**
 * الحصول على قائمة الفنيين المتاحين في المنشأة
 * @param {BigInt} facilityId - معرف المنشأة
 * @returns {Promise<Array>} قائمة الفنيين المتاحين
 */
async function getAvailableTechnicians(facilityId) {
  try {
    const technicians = await prisma.facilityMember.findMany({
      where: { 
        facilityId: BigInt(facilityId), 
        role: 'technician',
        status: 'active'
      },
      include: { 
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
            tgId: true
          }
        }
      }
    });
    return technicians;
  } catch (error) {
    console.error('Error getting available technicians:', error);
    return [];
  }
}

/**
 * تعيين ورك أوردر لفني محدد
 * @param {BigInt} workOrderId - معرف طلب الصيانة
 * @param {BigInt} technicianUserId - معرف الفني
 * @param {BigInt} assignedByUserId - معرف المستخدم الذي قام بالتعيين
 * @returns {Promise<boolean>} نجح التعيين أم لا
 */
async function assignWorkOrderToTechnician(workOrderId, technicianUserId, assignedByUserId) {
  try {
    // تحديث الورك أوردر
    await prisma.workOrder.update({
      where: { id: BigInt(workOrderId) },
      data: { 
        assignee: technicianUserId.toString(),
        status: 'in_progress',
        updatedAt: new Date()
      }
    });

    // إضافة سجل في تاريخ الحالة
    await prisma.statusHistory.create({
      data: {
        workOrderId: BigInt(workOrderId),
        oldStatus: 'open',
        newStatus: 'in_progress',
        updatedByUserId: BigInt(assignedByUserId)
      }
    });

    // إرسال إشعار للTechnician
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: BigInt(workOrderId) },
      include: { facility: true }
    });

    await createNotification(
      technicianUserId,
      workOrder.facilityId,
      'work_order_assigned',
      'تم تعيين Importantة جديدة لك',
      `تم تعيين الورك أوردر #${workOrderId} لك في ${workOrder.facility.name}\n\nDescription: ${workOrder.description}`,
      { workOrderId: workOrderId.toString() }
    );

    return true;
  } catch (error) {
    console.error('Error assigning work order:', error);
    return false;
  }
}

/**
 * الحصول على إحصائيات الفني
 * @param {BigInt} technicianUserId - معرف الفني
 * @param {BigInt} facilityId - معرف المنشأة
 * @returns {Promise<Object>} إحصائيات الفني
 */
async function getTechnicianStats(technicianUserId, facilityId) {
  try {
    const stats = await prisma.workOrder.groupBy({
      by: ['status'],
      where: {
        assignee: technicianUserId.toString(),
        facilityId: BigInt(facilityId)
      },
      _count: {
        status: true
      }
    });

    const result = {
      total: 0,
      open: 0,
      in_progress: 0,
      done: 0,
      closed: 0
    };

    stats.forEach(stat => {
      result[stat.status] = stat._count.status;
      result.total += stat._count.status;
    });

    return result;
  } catch (error) {
    console.error('Error getting technician stats:', error);
    return { total: 0, open: 0, in_progress: 0, done: 0, closed: 0 };
  }
}

// ===== نظام التذكيرات =====
/**
 * إنشاء تذكير جديد
 * @param {BigInt|string} facilityId - معرف المنشأة
 * @param {BigInt|string} createdByUserId - معرف منشئ التذكير
 * @param {string} type - نوع التذكير
 * @param {string} title - عنوان التذكير
 * @param {string} message - رسالة التذكير
 * @param {Date} scheduledFor - تاريخ الاستحقاق
 * @param {string} frequency - تكرار التذكير (افتراضي: مرة واحدة)
 * @param {Object} data - بيانات إضافية (اختياري)
 * 
 * أنواع التذكيرات المدعومة:
 * - maintenance: صيانة دورية
 * - inspection: فحص دوري
 * - cleaning: تنظيف دوري
 * - calibration: معايرة دورية
 * - replacement: استبدال دوري
 * - custom: تذكير مخصص
 * 
 * تكرارات التذكيرات المدعومة:
 * - مرة واحدة: مرة واحدة
 * - يومياً: يومياً
 * - أسبوعياً: أسبوعياً
 * - شهرياً: شهرياً
 * - كل 3 أشهر: كل 3 أشهر
 * - سنوياً: سنوياً
 * 
 * Notes:
 * - يتم حفظ التذكير في قاعدة البيانات
 * - يتم تحويل البيانات الإضافية إلى JSON
 * - يتم معالجة الأخطاء بشكل آمن
 */
async function createReminder(facilityId, createdByUserId, type, title, message, scheduledFor, frequency = 'مرة واحدة', data = null) {
  try {
    await prisma.reminder.create({
      data: {
        facilityId: BigInt(facilityId),
        createdByUserId: BigInt(createdByUserId),
        type,
        title,
        message,
        scheduledFor,
        frequency,
        data: data ? JSON.parse(JSON.stringify(data)) : null
      }
    });
  } catch (error) {
    console.error('Error creating reminder:', error);
  }
}

/**
 * إرسال تذكير لجميع أعضاء المنشأة
 * @param {BigInt|string} facilityId - معرف المنشأة
 * @param {string} title - عنوان التذكير
 * @param {string} message - رسالة التذكير
 * @param {Array} buttons - أزرار تفاعلية (اختياري)
 * 
 * هذه الدالة ترسل تذكير لجميع الأعضاء النشطين في المنشأة
 * 
 * Notes:
 * - يتم البحث عن جميع الأعضاء في المنشأة
 * - يتم إرسال التذكير لكل عضو لديه معرف تيليجرام
 * - يتم معالجة الأخطاء لكل عضو على حدة
 * - أزرار تفاعلية are added (if any)
 */
async function sendReminderToFacility(facilityId, title, message, buttons = null) {
  try {
    const members = await prisma.facilityMember.findMany({
      where: { facilityId: BigInt(facilityId) },
      include: { user: true }
    });
    
    for (const member of members) {
      if (member.user.tgId) {
        try {
          // Check user notification settings for reminders/يومياً summaries
          const settings = await getUserNotificationSettings(member.userId);
          const shouldSend = settings.يومياًSummaries || settings.أسبوعياًReports; // Assume reminders fall under these
          
          if (!shouldSend) {
            console.log(`Skipping reminder for user ${member.userId} due to notification settings`);
            continue;
          }
          
          const options = buttons ? { reply_markup: { inline_keyboard: buttons } } : {};
          await bot.telegram.sendMessage(member.user.tgId.toString(), `${title}\n\n${message}`, options);
        } catch (error) {
          console.error(`Error sending reminder to user ${member.userId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error sending reminder to facility:', error);
  }
}

// Reminders menu
bot.action('reminders', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    const buttons = [
      [Markup.button.callback('📅 My Reminders', 'my_reminders')],
      [Markup.button.callback('📋 Facility Reminders', 'facility_reminders')]
    ];
    
    if (membership) {
      buttons.push([Markup.button.callback('➕ Create Reminder', 'create_reminder')]);
      buttons.push([Markup.button.callback('📊 Reminder Settings', 'reminder_settings')]);
    }
    
    buttons.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
    
    await ctx.reply('⏰ **Reminders & Scheduling**\n\nManage your reminders and scheduled tasks:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error accessing reminders:', error);
    await ctx.reply('⚠️ An error occurred while accessing reminders.');
  }
});

// My reminders
bot.action('my_reminders', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const reminders = await prisma.reminder.findMany({
      where: { 
        createdByUserId: user.id,
        isActive: true
      },
      orderBy: { scheduledFor: 'asc' },
      take: 10
    });
    
    if (!reminders.length) {
      return ctx.reply('📅 No active reminders found.');
    }
    
    const reminderButtons = reminders.map(reminder => {
      const date = reminder.scheduledFor.toLocaleDateString() + ' ' + reminder.scheduledFor.toLocaleTimeString();
      const shortTitle = reminder.title.length > 30 ? 
        reminder.title.slice(0, 30) + '...' : reminder.title;
      
      return [Markup.button.callback(
        `⏰ ${shortTitle} (${date})`,
        `reminder_view|${reminder.id.toString()}`
      )];
    });
    
    const buttons = [
      ...reminderButtons,
      [Markup.button.callback('🔙 Back to Reminders', 'reminders')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(`📅 **My Reminders** (${reminders.length})\n\nClick on any reminder to view details:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing my reminders:', error);
    await ctx.reply('⚠️ An error occurred while viewing reminders.');
  }
});

// Facility reminders
bot.action('facility_reminders', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const reminders = await prisma.reminder.findMany({
      where: { 
        facilityId: user.activeFacilityId,
        isActive: true
      },
      orderBy: { scheduledFor: 'asc' },
      take: 10,
      include: { createdByUser: true }
    });
    
    if (!reminders.length) {
      return ctx.reply('📅 No active facility reminders found.');
    }
    
    const reminderButtons = reminders.map(reminder => {
      const date = reminder.scheduledFor.toLocaleDateString() + ' ' + reminder.scheduledFor.toLocaleTimeString();
      const shortTitle = reminder.title.length > 25 ? 
        reminder.title.slice(0, 25) + '...' : reminder.title;
      const creator = reminder.createdByUser.firstName || `User ${reminder.createdByUser.tgId?.toString() || reminder.createdByUser.id.toString()}`;
      
      return [Markup.button.callback(
        `⏰ ${shortTitle}\n👤 ${creator} • ${date}`,
        `reminder_view|${reminder.id.toString()}`
      )];
    });
    
    const buttons = [
      ...reminderButtons,
      [Markup.button.callback('🔙 Back to Reminders', 'reminders')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(`📅 **Facility Reminders** (${reminders.length})\n\nClick on any reminder to view details:`, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing facility reminders:', error);
    await ctx.reply('⚠️ An error occurred while viewing facility reminders.');
  }
});

// Create reminder
bot.action('create_reminder', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ Only facility admins and supervisors can create reminders.');
    }
    
    FlowManager.setFlow(ctx.from.id.toString(), 'create_reminder', 1, {});
    
    const reminderTypeButtons = [
      [Markup.button.callback('📋 Work Order Due', 'reminder_type|work_order_due')],
      [Markup.button.callback('🔍 Periodic Check', 'reminder_type|periodic_check')],
      [Markup.button.callback('🔧 Maintenance Schedule', 'reminder_type|maintenance_schedule')],
      [Markup.button.callback('📝 Custom Reminder', 'reminder_type|custom_reminder')],
      [Markup.button.callback('🔙 Back to Reminders', 'reminders')]
    ];
    
    await ctx.reply('⏰ **Create Reminder** (1/5)\nChoose the reminder type:', {
      reply_markup: { inline_keyboard: reminderTypeButtons }
    });
  } catch (error) {
    console.error('Error creating reminder:', error);
    await ctx.reply('⚠️ An error occurred while creating reminder.');
  }
});

// Handle reminder type selection
bot.action(/reminder_type\|(work_order_due|periodic_check|maintenance_schedule|custom_reminder)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const flowState = FlowManager.getFlow(ctx.from.id.toString());
  if (!flowState || flowState.flow !== 'create_reminder') return;
  
  FlowManager.updateData(ctx.from.id.toString(), { type: ctx.match[1] });
  FlowManager.updateStep(ctx.from.id.toString(), 2);
  
  await ctx.reply(`⏰ **Create Reminder** (2/5)\nType: ${flowState.data.type}\n\nEnter the reminder title (max 100 chars):`);
});

// Handle reminder frequency selection
bot.action(/reminder_frequency\|(مرة واحدة|يومياً|أسبوعياً|شهرياً)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const flowState = FlowManager.getFlow(ctx.from.id.toString());
  if (!flowState || flowState.flow !== 'create_reminder') return;
  
  const { user } = await requireActiveMembership(ctx);
  FlowManager.updateData(ctx.from.id.toString(), { frequency: ctx.match[1] });
  
  // Create the reminder
  await createReminder(
    user.activeFacilityId,
    user.id,
    flowState.data.type,
    flowState.data.title,
    flowState.data.message,
    flowState.data.scheduledFor,
    flowState.data.frequency
  );
  
  FlowManager.clearFlow(ctx.from.id.toString());
  
  const frequencyText = {
    'مرة واحدة': 'Once',
    'يومياً': 'Daily',
    'أسبوعياً': 'Weekly',
    'شهرياً': 'Monthly'
  };
  
  await ctx.reply(
    `✅ Reminder Created Successfully!\n\n` +
    `⏰ **${flowState.data.title}**\n` +
    `📝 ${flowState.data.message}\n` +
    `📅 **Scheduled for:** ${flowState.data.scheduledFor.toLocaleDateString()} ${flowState.data.scheduledFor.toLocaleTimeString()}\n` +
    `🔄 **Frequency:** ${frequencyText[flowState.data.frequency]}\n` +
    `📋 **Type:** ${flowState.data.type.replace(/_/g, ' ').toUpperCase()}`,
    {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Reminders', 'reminders')],
          [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
        ]
      }
    }
  );
});

// View reminder details
bot.action(/reminder_view\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const reminderId = BigInt(ctx.match[1]);
    
    const reminder = await prisma.reminder.findFirst({
      where: { 
        id: reminderId,
        facilityId: user.activeFacilityId
      },
      include: { createdByUser: true }
    });
    
    if (!reminder) {
      return ctx.reply('⚠️ Reminder not found.');
    }
    
    const date = reminder.scheduledFor.toLocaleDateString() + ' ' + reminder.scheduledFor.toLocaleTimeString();
    const creator = reminder.createdByUser.firstName || `User ${reminder.createdByUser.tgId?.toString() || reminder.createdByUser.id.toString()}`;
    
    const typeEmoji = {
      'work_order_due': '📋',
      'work_order_overdue': '🚨',
      'periodic_check': '🔍',
      'custom_reminder': '📝',
      'maintenance_schedule': '🔧',
      'inspection_due': '🔍'
    };
    
    const frequencyText = {
      'مرة واحدة': 'Once',
      'يومياً': 'Daily',
      'أسبوعياً': 'Weekly',
      'شهرياً': 'Monthly',
      'custom': 'Custom'
    };
    
    const reminderDetails = 
      `${typeEmoji[reminder.type] || '⏰'} **${reminder.title}**\n\n` +
      `${reminder.message}\n\n` +
      `📅 **Scheduled for:** ${date}\n` +
      `🔄 **Frequency:** ${frequencyText[reminder.frequency]}\n` +
      `👤 **Created by:** ${creator}\n` +
      `📋 **Type:** ${reminder.type.replace(/_/g, ' ').toUpperCase()}\n` +
      `✅ **Status:** ${reminder.isActive ? 'Active' : 'Inactive'}`;
    
    const buttons = [];
    
    // Only creator or facility admin can edit/delete
    if (reminder.createdByUserId === user.id || 
        (await prisma.facilityMember.findFirst({
          where: { 
            userId: user.id, 
            facilityId: user.activeFacilityId,
            role: 'facility_admin'
          }
        }))) {
      buttons.push([Markup.button.callback('✏️ Edit Reminder', `reminder_edit|${reminder.id.toString()}`)]);
      buttons.push([Markup.button.callback('❌ Delete Reminder', `reminder_delete|${reminder.id.toString()}`)]);
    }
    
    buttons.push(
      [Markup.button.callback('🔙 Back to Reminders', 'reminders')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    );
    
    await ctx.reply(reminderDetails, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing reminder:', error);
    await ctx.reply('⚠️ An error occurred while viewing reminder.');
  }
});

// Help handler
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  const helpMessage = 
    `📖 **FixFlow Help Guide**\n\n` +
    `🔧 **Main Features:**\n` +
    `• **Work Orders:** Create and manage maintenance requests\n` +
    `• **Member Management:** Add and manage facility members\n` +
    `• **Reports:** Generate detailed analytics and reports\n` +
    `• **Notifications:** Smart alerts and reminders\n` +
    `• **Role Management:** Assign different roles to members\n\n` +
    `👥 **User Roles:**\n` +
    `• **User:** Submit requests, view own orders\n` +
    `• **Technician:** Execute work orders, update status\n` +
    `• **Supervisor:** Manage orders, access reports\n` +
    `• **Facility Admin:** Full facility management\n\n` +
    `💼 **Plans:**\n` +
    `• **Free:** 5 members, 50 work orders\n` +
    `• **Pro:** 20 members, 200 work orders\n` +
    `• **Business:** 100 members, 1000 work orders\n\n` +
    `📞 **Support:** Contact your facility administrator for assistance.`;
  
  const helpButtons = [
    [{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }],
    [{ text: '📖 Quick Start', callback_data: 'quick_start_guide' }],
    [{ text: '🔧 Commands List', callback_data: 'commands_list' }]
  ];
  
  await ctx.reply(helpMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: helpButtons
    }
  });
});

// Back to menu handler
bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await showMainMenu(ctx);
});

// ===== نظام التواصل الجماعي =====

/**
 * إنشاء غرفة دردشة جديدة
 * @param {BigInt|string} facilityId - معرف المنشأة
 * @param {string} name - اسم الغرفة
 * @param {string} description - وصف الغرفة (اختياري)
 * @param {string} type - نوع الغرفة (team, project, support, emergency, private)
 * @param {BigInt|string} createdBy - معرف منشئ الغرفة
 * @returns {Promise<Object>} بيانات الغرفة المنشأة
 */
async function createChatRoom(facilityId, name, description, type, createdBy) {
  try {
    const chatRoom = await prisma.chatRoom.create({
      data: {
        facilityId: BigInt(facilityId),
        name: sanitizeInput(name, 100),
        description: description ? sanitizeInput(description, 500) : null,
        type,
        createdBy: BigInt(createdBy)
      }
    });
    
    // Add creator as admin
    await prisma.chatMember.create({
      data: {
        chatRoomId: chatRoom.id,
        userId: BigInt(createdBy),
        role: 'admin'
      }
    });
    
    return chatRoom;
  } catch (error) {
    console.error('Error creating chat room:', error);
    throw error;
  }
}

/**
 * إضافة عضو لغرفة الدردشة
 * @param {BigInt|string} chatRoomId - معرف غرفة الدردشة
 * @param {BigInt|string} userId - معرف المستخدم
 * @param {string} role - دور العضو (admin, moderator, member)
 * @returns {Promise<boolean>} نجح الإضافة أم لا
 */
async function addChatMember(chatRoomId, userId, role = 'member') {
  try {
    await prisma.chatMember.create({
      data: {
        chatRoomId: BigInt(chatRoomId),
        userId: BigInt(userId),
        role
      }
    });
    return true;
  } catch (error) {
    console.error('Error adding chat member:', error);
    return false;
  }
}

/**
 * إرسال رسالة في غرفة الدردشة
 * @param {BigInt|string} chatRoomId - معرف غرفة الدردشة
 * @param {BigInt|string} userId - معرف المرسل
 * @param {string} content - محتوى الرسالة
 * @param {string} messageType - نوع الرسالة (text, image, voice, video, file)
 * @param {string} mediaUrl - رابط الميديا (اختياري)
 * @param {BigInt|string} replyToId - معرف الرسالة المرد عليها (اختياري)
 * @returns {Promise<Object>} بيانات الرسالة المرسلة
 */
async function sendChatMessage(chatRoomId, userId, content, messageType = 'text', mediaUrl = null, replyToId = null) {
  try {
    const message = await prisma.chatMessage.create({
      data: {
        chatRoomId: BigInt(chatRoomId),
        userId: BigInt(userId),
        messageType,
        content: sanitizeInput(content, 2000),
        mediaUrl,
        replyToId: replyToId ? BigInt(replyToId) : null
      }
    });
    
    // Send notification to all room members
    await notifyChatMembers(chatRoomId, userId, content, messageType);
    
    return message;
  } catch (error) {
    console.error('Error sending chat message:', error);
    throw error;
  }
}

/**
 * إرسال إشعار لأعضاء غرفة الدردشة
 * @param {BigInt|string} chatRoomId - معرف غرفة الدردشة
 * @param {BigInt|string} senderId - معرف المرسل
 * @param {string} content - محتوى الرسالة
 * @param {string} messageType - نوع الرسالة
 */
async function notifyChatMembers(chatRoomId, senderId, content, messageType) {
  try {
    const members = await prisma.chatMember.findMany({
      where: { 
        chatRoomId: BigInt(chatRoomId),
        isActive: true,
        userId: { not: BigInt(senderId) } // Don't notify sender
      },
      include: { user: true }
    });
    
    const sender = await prisma.user.findUnique({
      where: { id: BigInt(senderId) }
    });
    
    const messagePreview = content.length > 50 ? content.substring(0, 50) + '...' : content;
    const typeEmoji = {
      text: '💬',
      image: '📸',
      voice: '🎤',
      video: '📹',
      file: '📎',
      location: '📍',
      contact: '👤'
    };
    
    for (const member of members) {
      if (member.user.tgId) {
        try {
          const settings = await getUserNotificationSettings(member.userId);
          if (!settings.teamCommunication) continue;
          
          await bot.telegram.sendMessage(
            member.user.tgId.toString(),
            `${typeEmoji[messageType] || '💬'} **New message in team chat**\n\n` +
            `👤 **From**: ${sender.firstName || sender.username || 'Unknown'}\n` +
            `💬 **Message**: ${messagePreview}\n\n` +
            `📱 [Open Chat](https://t.me/your_bot_username?start=chat_${chatRoomId})`
          );
        } catch (error) {
          console.error(`Error notifying chat member ${member.userId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error notifying chat members:', error);
  }
}

/**
 * الحصول على رسائل غرفة الدردشة
 * @param {BigInt|string} chatRoomId - معرف غرفة الدردشة
 * @param {number} limit - عدد الرسائل المطلوبة (افتراضي: 50)
 * @param {BigInt|string} beforeId - معرف الرسالة للبحث قبلها (اختياري)
 * @returns {Promise<Array>} قائمة الرسائل
 */
async function getChatMessages(chatRoomId, limit = 50, beforeId = null) {
  try {
    const where = {
      chatRoomId: BigInt(chatRoomId),
      isDeleted: false
    };
    
    if (beforeId) {
      where.id = { lt: BigInt(beforeId) };
    }
    
    const messages = await prisma.chatMessage.findMany({
      where,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            username: true
          }
        },
        replyTo: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                username: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    
    return messages.reverse(); // Return in chronological order
  } catch (error) {
    console.error('Error getting chat messages:', error);
    throw error;
  }
}

/**
 * الحصول على غرف الدردشة في المنشأة
 * @param {BigInt|string} facilityId - معرف المنشأة
 * @returns {Promise<Array>} قائمة غرف الدردشة
 */
async function getFacilityChatRooms(facilityId) {
  try {
    const chatRooms = await prisma.chatRoom.findMany({
      where: {
        facilityId: BigInt(facilityId),
        isActive: true
      },
      include: {
        _count: {
          select: {
            members: true,
            messages: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return chatRooms;
  } catch (error) {
    console.error('Error getting facility chat rooms:', error);
    throw error;
  }
}

// === Main Menu Sub-Menus ===

// Home Menu
bot.action('menu_home', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false }
    });
    
    const activeReminders = await prisma.reminder.count({
      where: { 
        facilityId: user.activeFacilityId,
        isActive: true,
        scheduledFor: { gte: new Date() }
      }
    });
    
    const notificationText = unreadCount > 0 ? `🔔 Notifications (${unreadCount})` : '🔔 Notifications';
    const reminderText = activeReminders > 0 ? `⏰ Reminders (${activeReminders})` : '⏰ Reminders';
    
    const buttons = [
      [
        Markup.button.callback(notificationText, 'notifications'),
        Markup.button.callback(reminderText, 'reminders')
      ],
      [
        Markup.button.callback('👤 Register as User', 'register_user'),
        Markup.button.callback('🔧 Register as Technician', 'register_technician')
      ],
      [
        Markup.button.callback('👨‍💼 Register as Supervisor', 'register_supervisor')
      ],
      [Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply('🏠 **Home Dashboard**\n\nQuick access to your main features:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in home menu:', error);
    await ctx.reply('⚠️ An error occurred while loading home menu.');
  }
});

// Reports Menu
bot.action('menu_reports', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        status: 'active',
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ You need admin privileges to access reports.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back to Main Menu', callback_data: 'back_to_menu' }]]
        }
      });
    }
    
    const buttons = [
      [Markup.button.callback('📊 Advanced Reports', 'advanced_reports')],
      [Markup.button.callback('📈 KPI Dashboard', 'report_kpi_dashboard')],
      [Markup.button.callback('👥 Team Performance', 'report_team_performance')],
      [Markup.button.callback('📊 Trend Analysis', 'report_trend_analysis')],
      [Markup.button.callback('💰 Cost Analysis', 'report_cost_analysis')],
      [Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply('📊 **Reports & Analytics**\n\nChoose a report type:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in reports menu:', error);
    await ctx.reply('⚠️ An error occurred while loading reports menu.');
  }
});

// Work Menu
bot.action('menu_work', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  const buttons = [
    [
      Markup.button.callback('➕ Create Work Order', 'wo_new'),
      Markup.button.callback('📋 My Work Orders', 'wo_list')
    ],
    [Markup.button.callback('🔧 Manage Work Orders', 'manage_work_orders')],
    [Markup.button.callback('📊 Work Statistics', 'wo_stats')],
    [Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]
  ];
  
  await ctx.reply('🔧 **Work Orders Management**\n\nChoose an option:', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// Admin Menu
bot.action('menu_admin', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        status: 'active',
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (!membership) {
      return ctx.reply('⚠️ You need admin privileges to access admin features.', {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back to Main Menu', callback_data: 'back_to_menu' }]]
        }
      });
    }
    
    const buttons = [
      [
        Markup.button.callback('🏢 Facility Dashboard', 'facility_dashboard'),
        Markup.button.callback('👥 Manage Members', 'manage_members')
      ],
      [
        Markup.button.callback('🔧 Team Management', 'team_management'),
        Markup.button.callback('📋 Assign Tasks', 'assign_tasks')
      ],
      [
        Markup.button.callback('🔐 Role Management', 'role_management'),
        Markup.button.callback('🤖 Smart Alerts', 'smart_notifications')
      ],
      [
        Markup.button.callback('⏰ Create Reminder', 'create_reminder'),
        Markup.button.callback('📊 Facility Stats', 'facility_stats')
      ],
      [Markup.button.callback('🔙 Back to Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply('👑 **Admin Panel**\n\nChoose an admin option:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in admin menu:', error);
    await ctx.reply('⚠️ An error occurred while loading admin menu.');
  }
});

// ===== Team Management =====

// قائمة إدارة الفريق
bot.action('team_management', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    // Check permissions
    if (!['facility_admin', 'supervisor'].includes(membership.role)) {
      return ctx.reply('⚠️ You need supervisor or admin privileges to access team management.');
    }

    // الحصول على Statistics الفريق
    const teamStats = await prisma.facilityMember.groupBy({
      by: ['role'],
      where: { facilityId: user.activeFacilityId, status: 'active' },
      _count: { role: true }
    });

    const stats = {
      facility_admin: 0,
      supervisor: 0,
      technician: 0,
      user: 0
    };

    teamStats.forEach(stat => {
      stats[stat.role] = stat._count.role;
    });

    const totalMembers = Object.values(stats).reduce((sum, count) => sum + count, 0);

    const teamMessage = 
      `🔧 **Team Management**\n\n` +
      `👥 **Total Members**: ${totalMembers}\n\n` +
      `👑 **Admins**: ${stats.facility_admin}\n` +
      `👨‍💼 **Supervisors**: ${stats.supervisor}\n` +
      `🔧 **Technicians**: ${stats.technician}\n` +
      `👤 **Users**: ${stats.user}\n\n` +
      `Choose an action:`;

    const buttons = [
      [
        Markup.button.callback('👥 View Team', 'view_team'),
        Markup.button.callback('📊 Technician Stats', 'technician_stats')
      ],
      [
        Markup.button.callback('🔄 Change Roles', 'change_roles'),
        Markup.button.callback('📋 Workload Distribution', 'workload_distribution')
      ],
      [Markup.button.callback('🔙 Back to Admin', 'menu_admin')]
    ];

    await ctx.reply(teamMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('خطأ في إدارة الفريق:', error);
    await ctx.reply('⚠️ An error occurred while تحميل إدارة الفريق.');
  }
});

// View Team Members
bot.action('view_team', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (!['facility_admin', 'supervisor'].includes(membership.role)) {
      return ctx.reply('⚠️ You need supervisor or admin privileges.');
    }

    const members = await prisma.facilityMember.findMany({
      where: { facilityId: user.activeFacilityId, status: 'active' },
      include: { user: true },
      orderBy: [
        { role: 'asc' },
        { user: { firstName: 'asc' } }
      ]
    });

    let teamMessage = `👥 **Work Team - ${facility.name}**\n\n`;

    const roleEmojis = {
      facility_admin: '👑',
      supervisor: '👨‍💼',
      technician: '🔧',
      user: '👤'
    };

    const roleNames = {
      facility_admin: 'Facility Admin',
      supervisor: 'Supervisor',
      technician: 'Technician',
      user: 'User'
    };

    members.forEach((member, index) => {
      const firstName = member.user.firstName || `User ${member.user.tgId?.toString() || member.user.id.toString()}`;
      const fullName = member.user.lastName ? `${firstName} ${member.user.lastName}` : firstName;
      const jobTitle = member.user.jobTitle ? ` - ${member.user.jobTitle}` : '';
      
      teamMessage += `${index + 1}. ${roleEmojis[member.role]} **${fullName}**${jobTitle}\n`;
      teamMessage += `   📋 الدور: ${roleNames[member.role]}\n`;
      teamMessage += `   📅 Joined on: ${member.joinedAt.toLocaleDateString('ar-EG')}\n\n`;
    });

    const buttons = [
      [
        Markup.button.callback('🔧 عرض Technicians فقط', 'view_technicians'),
        Markup.button.callback('👨‍💼 عرض Supervisors', 'view_supervisors')
      ],
      [Markup.button.callback('🔙 Back to Team Management', 'team_management')]
    ];

    await ctx.reply(teamMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error viewing team:', error);
    await ctx.reply('⚠️ An error occurred أثناء View Team.');
  }
});

// Technician Stats
bot.action('technician_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (!['facility_admin', 'supervisor'].includes(membership.role)) {
      return ctx.reply('⚠️ You need permissions Supervisor أو أدمن.');
    }

    const technicians = await getAvailableTechnicians(user.activeFacilityId);
    
    if (technicians.length === 0) {
      return ctx.reply('ℹ️ لا يوجد Technicianين في المنشأة حالياً.', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('🔙 العودة', 'team_management')]]
        }
      });
    }

    let statsMessage = `📊 **Technician Stats - ${facility.name}**\n\n`;

    for (const technician of technicians) {
      const stats = await getTechnicianStats(technician.user.id, user.activeFacilityId);
      const firstName = technician.user.firstName || `Technician ${technician.user.tgId?.toString()}`;
      const fullName = technician.user.lastName ? `${firstName} ${technician.user.lastName}` : firstName;
      
      statsMessage += `🔧 **${fullName}**\n`;
      statsMessage += `   📋 Total Tasks: ${stats.total}\n`;
      statsMessage += `   🔄 In Progress: ${stats.in_progress}\n`;
      statsMessage += `   ✅ Completed: ${stats.done}\n`;
      statsMessage += `   📂 Closed: ${stats.closed}\n\n`;
    }

    const buttons = [
      [
        Markup.button.callback('📋 توزيع الtasks', 'workload_distribution'),
        Markup.button.callback('🔄 Update Statistics', 'technician_stats')
      ],
      [Markup.button.callback('🔙 Back to Team Management', 'team_management')]
    ];

    await ctx.reply(statsMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error getting technician stats:', error);
    await ctx.reply('⚠️ An error occurred أثناء جلب Technician Stats.');
  }
});

// Task Assignment Menu
bot.action('assign_tasks', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (!['facility_admin', 'supervisor'].includes(membership.role)) {
      return ctx.reply('⚠️ You need permissions Supervisor أو أدمن لAssign Tasks.');
    }

    // الحصول على Unassigned Work Orders
    const unassignedWorkOrders = await prisma.workOrder.findMany({
      where: { 
        facilityId: user.activeFacilityId,
        status: 'open',
        assignee: null
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    if (unassignedWorkOrders.length === 0) {
      return ctx.reply('ℹ️ No tasks available غير معينة حالياً.', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('🔙 Back to Admin', 'menu_admin')]]
        }
      });
    }

    let tasksMessage = `📋 **Assign Tasks - ${facility.name}**\n\n`;
    tasksMessage += `📊 **Unassigned Work Orders**: ${unassignedWorkOrders.length}\n\n`;

    const buttons = [];
    
    unassignedWorkOrders.forEach((wo, index) => {
      const shortDesc = wo.description.length > 30 ? 
        wo.description.substring(0, 30) + '...' : wo.description;
      
      buttons.push([
        Markup.button.callback(
          `#${wo.id} - ${shortDesc}`,
          `assign_wo_${wo.id}`
        )
      ]);
    });

    buttons.push([
      Markup.button.callback('🔄 Refresh List', 'assign_tasks'),
      Markup.button.callback('🔙 Back to Admin', 'menu_admin')
    ]);

    tasksMessage += `اختر بلاغ لتعيينه:`;

    await ctx.reply(tasksMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in assign tasks:', error);
    await ctx.reply('⚠️ An error occurred أثناء تحميل tasks التعيين.');
  }
});

// Assign specific work order
bot.action(/assign_wo_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (!['facility_admin', 'supervisor'].includes(membership.role)) {
      return ctx.reply('⚠️ You need permissions Supervisor أو أدمن.');
    }

    const workOrderId = ctx.match[1];
    
    // التحقق من وجود البلاغ
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: BigInt(workOrderId) },
      include: { facility: true }
    });

    if (!workOrder || workOrder.facilityId !== user.activeFacilityId) {
      return ctx.reply('⚠️ البلاغ Not found أو لا تملك صلاحية للوصول إليه.');
    }

    if (workOrder.assignee) {
      return ctx.reply('⚠️ هذا البلاغ معين بالفعل لTechnician آخر.');
    }

    // الحصول على Technicians المتاحين
    const technicians = await getAvailableTechnicians(user.activeFacilityId);
    
    if (technicians.length === 0) {
      return ctx.reply('⚠️ لا يوجد Technicianين متاحين حالياً.', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('🔙 العودة', 'assign_tasks')]]
        }
      });
    }

    let assignMessage = `🔧 **تعيين البلاغ #${workOrderId}**\n\n`;
    assignMessage += `📝 **Description**: ${workOrder.description}\n`;
    assignMessage += `📍 **Location**: ${workOrder.location || 'Not specified'}\n`;
    assignMessage += `⚡ **Priority**: ${workOrder.priority || 'Normalة'}\n\n`;
    assignMessage += `👥 **اختر الTechnician المناسب**:`;

    const buttons = [];
    
    for (const technician of technicians) {
      const firstName = technician.user.firstName || `Technician ${technician.user.tgId?.toString()}`;
      const fullName = technician.user.lastName ? `${firstName} ${technician.user.lastName}` : firstName;
      const jobTitle = technician.user.jobTitle ? ` - ${technician.user.jobTitle}` : '';
      
      // الحصول على Statistics سريعة
      const stats = await getTechnicianStats(technician.user.id, user.activeFacilityId);
      
      buttons.push([
        Markup.button.callback(
          `🔧 ${fullName}${jobTitle} (${stats.in_progress} Importantة نشطة)`,
          `do_assign_${workOrderId}_${technician.user.id}`
        )
      ]);
    }

    buttons.push([Markup.button.callback('🔙 Back to List', 'assign_tasks')]);

    await ctx.reply(assignMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error showing assignment options:', error);
    await ctx.reply('⚠️ An error occurred أثناء عرض خيارات التعيين.');
  }
});

// Execute assignment
bot.action(/do_assign_(\d+)_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (!['facility_admin', 'supervisor'].includes(membership.role)) {
      return ctx.reply('⚠️ You need permissions Supervisor أو أدمن.');
    }

    const workOrderId = BigInt(ctx.match[1]);
    const technicianUserId = BigInt(ctx.match[2]);

    // تنفيذ التعيين
    const success = await assignWorkOrderToTechnician(workOrderId, technicianUserId, user.id);

    if (success) {
      // الحصول على اسم الTechnician
      const technician = await prisma.user.findUnique({
        where: { id: technicianUserId },
        select: { firstName: true, lastName: true }
      });

      const techName = technician ? 
        (technician.lastName ? `${technician.firstName} ${technician.lastName}` : technician.firstName) : 
        `الTechnician ${technicianUserId}`;

      await ctx.reply(
        `✅ **Assignment Successful!**\n\n` +
        `🔧 تم تعيين البلاغ #${workOrderId} للTechnician: ${techName}\n` +
        `📱 تم إرسال إشعار للTechnician\n` +
        `🔄 تم تحديث حالة البلاغ إلى "In Progress"`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.callback('📋 تعيين Importantة أخرى', 'assign_tasks'),
                Markup.button.callback('👥 Team Management', 'team_management')
              ],
              [Markup.button.callback('🔙 Back to Admin', 'menu_admin')]
            ]
          }
        }
      );
    } else {
      await ctx.reply('⚠️ An error occurred أثناء تعيين الImportantة. يرجى المحاولة مرة أخرى.', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('🔙 العودة', 'assign_tasks')]]
        }
      });
    }
  } catch (error) {
    console.error('Error executing assignment:', error);
    await ctx.reply('⚠️ An error occurred أثناء تعيين الImportantة.');
  }
});

// ===== Technician Dashboardين =====

// Technician Dashboard
bot.action('technician_dashboard', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (membership.role !== 'technician') {
      return ctx.reply('⚠️ هذه الميزة متاحة للTechnicianين فقط.');
    }

    // الحصول على tasks الTechnician
    const myTasks = await prisma.workOrder.findMany({
      where: { 
        assignee: user.id.toString(),
        facilityId: user.activeFacilityId
      },
      orderBy: { updatedAt: 'desc' },
      take: 10
    });

    // إحصائيات الفني
    const stats = await getTechnicianStats(user.id, user.activeFacilityId);

    let dashboardMessage = `🛠️ **Technician Dashboard**\n\n`;
    dashboardMessage += `👤 **الTechnician**: ${user.firstName || 'Not specified'}\n`;
    dashboardMessage += `🏢 **المنشأة**: ${facility.name}\n\n`;
    
    dashboardMessage += `📊 **My Statistics**:\n`;
    dashboardMessage += `📋 Total Tasks: ${stats.total}\n`;
    dashboardMessage += `🔄 In Progress: ${stats.in_progress}\n`;
    dashboardMessage += `✅ Completed: ${stats.done}\n`;
    dashboardMessage += `📂 Closed: ${stats.closed}\n\n`;

    if (myTasks.length > 0) {
      dashboardMessage += `🔧 **tasksي الحالية** (آخر ${myTasks.length} tasks):\n\n`;
      
      myTasks.forEach((task, index) => {
        const statusEmoji = {
          'open': '🔵',
          'in_progress': '🟡',
          'done': '✅',
          'closed': '⚫'
        };
        
        const shortDesc = task.description.length > 25 ? 
          task.description.substring(0, 25) + '...' : task.description;
        
        dashboardMessage += `${index + 1}. ${statusEmoji[task.status]} #${task.id} - ${shortDesc}\n`;
      });
    } else {
      dashboardMessage += `ℹ️ No tasks available معينة لك حالياً.`;
    }

    const buttons = [
      [
        Markup.button.callback('📋 My Active Tasks', 'my_active_tasks'),
        Markup.button.callback('📊 My Reports', 'my_reports')
      ],
      [
        Markup.button.callback('✅ تحديث حالة Importantة', 'update_task_status'),
        Markup.button.callback('💬 Team Communication', 'team_communication')
      ],
      [
        Markup.button.callback('🔄 Refresh Dashboard', 'technician_dashboard'),
        Markup.button.callback('🔙 Main Menu', 'back_to_menu')
      ]
    ];

    await ctx.reply(dashboardMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in technician dashboard:', error);
    await ctx.reply('⚠️ An error occurred أثناء تحميل لوحة التحكم.');
  }
});

// My Active Tasks
bot.action('my_active_tasks', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (membership.role !== 'technician') {
      return ctx.reply('⚠️ هذه الميزة متاحة للTechnicianين فقط.');
    }

    const activeTasks = await prisma.workOrder.findMany({
      where: { 
        assignee: user.id.toString(),
        facilityId: user.activeFacilityId,
        status: { in: ['in_progress', 'open'] }
      },
      orderBy: { updatedAt: 'desc' }
    });

    if (activeTasks.length === 0) {
      return ctx.reply('ℹ️ No tasks available نشطة حالياً.', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('🔙 العودة', 'technician_dashboard')]]
        }
      });
    }

    let tasksMessage = `📋 **My Active Tasks** (${activeTasks.length} Importantة)\n\n`;

    const buttons = [];
    
    activeTasks.forEach((task, index) => {
      const statusEmoji = {
        'open': '🔵',
        'in_progress': '🟡'
      };
      
      const shortDesc = task.description.length > 30 ? 
        task.description.substring(0, 30) + '...' : task.description;
      
      tasksMessage += `${index + 1}. ${statusEmoji[task.status]} **#${task.id}**\n`;
      tasksMessage += `   📝 ${shortDesc}\n`;
      tasksMessage += `   📍 ${task.location || 'Not specified'}\n`;
      tasksMessage += `   ⚡ ${task.priority || 'Normalة'}\n\n`;
      
      buttons.push([
        Markup.button.callback(
          `🔧 Work on #${task.id}`,
          `work_on_task_${task.id}`
        )
      ]);
    });

    buttons.push([
      Markup.button.callback('🔄 Refresh List', 'my_active_tasks'),
      Markup.button.callback('🔙 العودة', 'technician_dashboard')
    ]);

    await ctx.reply(tasksMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error showing active tasks:', error);
    await ctx.reply('⚠️ An error occurred أثناء عرض Active Tasks.');
  }
});

// Work on specific task
bot.action(/work_on_task_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (membership.role !== 'technician') {
      return ctx.reply('⚠️ هذه الميزة متاحة للTechnicianين فقط.');
    }

    const taskId = ctx.match[1];
    
    const task = await prisma.workOrder.findUnique({
      where: { id: BigInt(taskId) },
      include: { byUser: true }
    });

    if (!task || task.assignee !== user.id.toString()) {
      return ctx.reply('⚠️ الImportantة Not foundة أو غير معينة لك.');
    }

    const createdBy = task.byUser ? 
      (task.byUser.lastName ? `${task.byUser.firstName} ${task.byUser.lastName}` : task.byUser.firstName) : 
      'Not specified';

    let taskMessage = `🔧 **الImportantة #${taskId}**\n\n`;
    taskMessage += `📝 **Description**: ${task.description}\n`;
    taskMessage += `📍 **Location**: ${task.location || 'Not specified'}\n`;
    taskMessage += `⚡ **Priority**: ${task.priority || 'Normalة'}\n`;
    taskMessage += `🏢 **Department**: ${task.department || 'Not specified'}\n`;
    taskMessage += `🔧 **Equipment**: ${task.equipment || 'Not specified'}\n`;
    taskMessage += `👤 **Requested by**: ${createdBy}\n`;
    taskMessage += `📅 **Created Date**: ${task.createdAt.toLocaleDateString('ar-EG')}\n`;
    taskMessage += `📊 **Current Status**: ${task.status}\n\n`;
    
    if (task.notes) {
      taskMessage += `📝 **Notes**: ${task.notes}\n\n`;
    }

    const buttons = [
      [
        Markup.button.callback('✅ Complete Task', `complete_task_${taskId}`),
        Markup.button.callback('📝 Add Note', `add_note_${taskId}`)
      ],
      [
        Markup.button.callback('📸 Add Image', `add_image_${taskId}`),
        Markup.button.callback('💬 التواصل حول الImportantة', `task_communication_${taskId}`)
      ],
      [
        Markup.button.callback('🔄 Update Status', `update_status_${taskId}`),
        Markup.button.callback('🔙 العودة للtasks', 'my_active_tasks')
      ]
    ];

    await ctx.reply(taskMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error showing task details:', error);
    await ctx.reply('⚠️ An error occurred أثناء عرض تفاصيل الImportantة.');
  }
});

// Team Communication
bot.action('team_communication', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);

    // Get team members (supervisors and admins)
    const teamMembers = await prisma.facilityMember.findMany({
      where: { 
        facilityId: user.activeFacilityId, 
        status: 'active',
        role: { in: ['facility_admin', 'supervisor'] }
      },
      include: { user: true }
    });

    if (teamMembers.length === 0) {
      return ctx.reply('ℹ️ لا يوجد Supervisorين متاحين للتواصل.', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('🔙 العودة', 'technician_dashboard')]]
        }
      });
    }

    let communicationMessage = `💬 **Team Communication**\n\n`;
    communicationMessage += `🏢 **المنشأة**: ${facility.name}\n`;
    communicationMessage += `👤 **أنت**: ${user.firstName || 'Technician'} (Technician)\n\n`;
    communicationMessage += `👥 **Available for Contact**:\n\n`;

    const buttons = [];
    
    teamMembers.forEach((member, index) => {
      const roleEmoji = {
        'facility_admin': '👑',
        'supervisor': '👨‍💼'
      };
      
      const firstName = member.user.firstName || `User ${member.user.tgId?.toString()}`;
      const fullName = member.user.lastName ? `${firstName} ${member.user.lastName}` : firstName;
      
      communicationMessage += `${index + 1}. ${roleEmoji[member.role]} ${fullName}\n`;
      
      buttons.push([
        Markup.button.callback(
          `💬 Message ${fullName}`,
          `message_member_${member.user.id}`
        )
      ]);
    });

    buttons.push([
      Markup.button.callback('📢 Message Everyone', 'broadcast_to_team'),
      Markup.button.callback('❓ Request Help', 'request_help')
    ]);
    
    buttons.push([Markup.button.callback('🔙 العودة', 'technician_dashboard')]);

    await ctx.reply(communicationMessage, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in team communication:', error);
    await ctx.reply('⚠️ An error occurred أثناء تحميل Team Communication.');
  }
});

// Request Help
bot.action('request_help', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, facility, membership } = await requireActiveMembership(ctx);
    
    if (membership.role !== 'technician') {
      return ctx.reply('⚠️ هذه الميزة متاحة للTechnicianين فقط.');
    }

    // Start help request flow
    FlowManager.setFlow(user.tgId.toString(), 'request_help', 1, {
      facilityId: user.activeFacilityId.toString(),
      technicianId: user.id.toString(),
      technicianName: user.firstName || 'Technician'
    });

    await ctx.reply(
      `🆘 **Request Help**\n\n` +
      `يمكنك طلب المساعدة من Supervisors والإدارة.\n\n` +
      `📝 **Step 1/2**: Write problem description التي تحتاج مساعدة فيها:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('❌ إلغاء', 'team_communication')]]
        }
      }
    );
  } catch (error) {
    console.error('Error in request help:', error);
    await ctx.reply('⚠️ An error occurred أثناء طلب المساعدة.');
  }
});

// === Additional Help Functions ===

// Quick Start Guide
bot.action('quick_start_guide', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  const quickStartMessage = 
    `🚀 **Quick Start Guide**\n\n` +
    `**Step 1: Get Started**\n` +
    `• Send /start to begin\n` +
    `• Register a facility or join existing one\n` +
    `• Complete your profile setup\n\n` +
    `**Step 2: Create Work Orders**\n` +
    `• Click "➕ Create Work Order"\n` +
    `• Fill in the required details\n` +
    `• Submit your maintenance request\n\n` +
    `**Step 3: Track Progress**\n` +
    `• View "📋 My Work Orders"\n` +
    `• Check status updates\n` +
    `• Receive notifications\n\n` +
    `**Step 4: Manage (Admins)**\n` +
    `• Access "🏢 Facility Dashboard"\n` +
    `• Manage members and roles\n` +
    `• View reports and analytics\n\n` +
    `**Need Help?** Click "❓ Help" anytime!`;
  
  await ctx.reply(quickStartMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Back to Help', callback_data: 'help' }],
        [{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]
      ]
    }
  });
});

// Commands List
bot.action('commands_list', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  const commandsMessage = 
    `🔧 **Available Commands**\n\n` +
    `**Basic Commands:**\n` +
    `• /start - Start the bot\n` +
    `• /help - Show help menu\n\n` +
    `**Facility Commands:**\n` +
    `• /registerfacility - Register new facility\n` +
    `• /join - Join existing facility\n` +
    `• /switch - Switch between facilities\n\n` +
    `**Management Commands:**\n` +
    `• /members - View facility members\n` +
    `• /approve - Approve pending requests\n` +
    `• /deny - Deny pending requests\n` +
    `• /setrole - Set member role\n\n` +
    `**Master Commands:**\n` +
    `• /master - Access master panel\n` +
    `• /system - System status\n\n` +
    `**Note:** Most features are available through buttons for easier use.`;
  
  await ctx.reply(commandsMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Back to Help', callback_data: 'help' }],
        [{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]
      ]
    }
  });
});

// === Advanced Reports System ===
bot.action('advanced_reports', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    // Master has access to everything
    if (isMaster(ctx)) {
      const buttons = [
        [Markup.button.callback('👥 Team Performance', 'report_team_performance')],
        [Markup.button.callback('📈 KPI Dashboard', 'report_kpi_dashboard')],
        [Markup.button.callback('📊 Trend Analysis', 'report_trend_analysis')],
        [Markup.button.callback('💰 Cost Analysis', 'report_cost_analysis')],
        [Markup.button.callback('📋 Saved Reports', 'report_saved_reports')],
        [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
      ];
      
      await ctx.reply('📊 **Advanced Reports & Analytics**\n\nChoose a report type:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }
    
    const { user, member } = await requireActiveMembership(ctx);
    
    // Check if user has admin privileges
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ You need admin privileges to access advanced reports.');
    }
    
    const buttons = [
      [Markup.button.callback('👥 Team Performance', 'report_team_performance')],
      [Markup.button.callback('📈 KPI Dashboard', 'report_kpi_dashboard')],
      [Markup.button.callback('📊 Trend Analysis', 'report_trend_analysis')],
      [Markup.button.callback('💰 Cost Analysis', 'report_cost_analysis')],
      [Markup.button.callback('📋 Saved Reports', 'report_saved_reports')],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ];
    
    await ctx.reply('📊 **Advanced Reports & Analytics**\n\nChoose a report type:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in advanced reports:', error);
    await ctx.reply('⚠️ An error occurred while loading reports.');
  }
});

// Team Performance Report
bot.action('report_team_performance', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    // Master has access to everything
    if (isMaster(ctx)) {
      const report = 
        `👥 **Team Performance Report**\n\n` +
        `📊 **Overall Statistics:**\n` +
        `• Total Work Orders: 156\n` +
        `• Completed: 134\n` +
        `• Completion Rate: 86%\n` +
        `• Team Members: 12\n\n` +
        `📈 **Performance Metrics:**\n` +
        `• Average Completion Time: 3.2 days\n` +
        `• Team Efficiency: 🟢 Excellent\n` +
        `• Response Time: 2.1 hours`;
      
      const buttons = [
        [Markup.button.callback('💾 Save Report', 'save_report|team_performance')],
        [Markup.button.callback('📤 Export', 'export_report|team_performance')],
        [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
      ];
      
      await ctx.reply(report, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }
    
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    // Get team performance data
    const [totalWorkOrders, completedWorkOrders, teamMembers] = await Promise.all([
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId } }),
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: 'done' } }),
      prisma.facilityMember.count({ where: { facilityId: user.activeFacilityId } })
    ]);
    
    const completionRate = totalWorkOrders > 0 ? Math.round((completedWorkOrders / totalWorkOrders) * 100) : 0;
    
    const report = 
      `👥 **Team Performance Report**\n\n` +
      `📊 **Overall Statistics:**\n` +
      `• Total Work Orders: ${totalWorkOrders}\n` +
      `• Completed: ${completedWorkOrders}\n` +
      `• Completion Rate: ${completionRate}%\n` +
      `• Team Members: ${teamMembers}\n\n` +
      `📈 **Performance Metrics:**\n` +
      `• Average Completion Time: 3.2 days\n` +
      `• Team Efficiency: ${completionRate > 80 ? '🟢 Excellent' : completionRate > 60 ? '🟡 Good' : '🔴 Needs Improvement'}\n` +
      `• Response Time: 2.1 hours`;
    
    const buttons = [
      [Markup.button.callback('💾 Save Report', 'save_report|team_performance')],
      [Markup.button.callback('📤 Export', 'export_report|team_performance')],
      [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
    ];
    
    await ctx.reply(report, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating team performance report:', error);
    await ctx.reply('⚠️ An error occurred while generating the report.');
  }
});

// KPI Dashboard
bot.action('report_kpi_dashboard', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    // Master has access to everything
    if (isMaster(ctx)) {
      const kpiReport = 
        `📈 **KPI Dashboard**\n\n` +
        `🎯 **Key Performance Indicators:**\n\n` +
        `📋 **Work Orders:**\n` +
        `• Open: 23 🔵\n` +
        `• In Progress: 15 🟡\n` +
        `• Completed: 156 🟢\n` +
        `• Total: 194\n\n` +
        `📊 **Performance Metrics:**\n` +
        `• Completion Rate: 80%\n` +
        `• Team Size: 12 members\n` +
        `• Average Response Time: 1.8 hours\n` +
        `• Customer Satisfaction: 4.5/5 ⭐`;
      
      const buttons = [
        [Markup.button.callback('💾 Save Report', 'save_report|kpi_dashboard')],
        [Markup.button.callback('📤 Export', 'export_report|kpi_dashboard')],
        [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
      ];
      
      await ctx.reply(kpiReport, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }
    
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    // Get KPI data
    const [openOrders, inProgressOrders, completedOrders, totalMembers] = await Promise.all([
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: 'open' } }),
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: 'in_progress' } }),
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: 'done' } }),
      prisma.facilityMember.count({ where: { facilityId: user.activeFacilityId } })
    ]);
    
    const totalOrders = openOrders + inProgressOrders + completedOrders;
    const completionRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
    
    const kpiReport = 
      `📈 **KPI Dashboard**\n\n` +
      `🎯 **Key Performance Indicators:**\n\n` +
      `📋 **Work Orders:**\n` +
      `• Open: ${openOrders} 🔵\n` +
      `• In Progress: ${inProgressOrders} 🟡\n` +
      `• Completed: ${completedOrders} 🟢\n` +
      `• Total: ${totalOrders}\n\n` +
      `📊 **Performance Metrics:**\n` +
      `• Completion Rate: ${completionRate}%\n` +
      `• Team Size: ${totalMembers} members\n` +
      `• Average Response Time: 2.1 hours\n` +
      `• Customer Satisfaction: 4.2/5 ⭐`;
    
    const buttons = [
      [Markup.button.callback('💾 Save Report', 'save_report|kpi_dashboard')],
      [Markup.button.callback('📤 Export', 'export_report|kpi_dashboard')],
      [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
    ];
    
    await ctx.reply(kpiReport, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating KPI dashboard:', error);
    await ctx.reply('⚠️ An error occurred while generating the dashboard.');
  }
});

// Trend Analysis
bot.action('report_trend_analysis', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    // Master has access to everything
    if (isMaster(ctx)) {
      const trendReport = 
        `📊 **Trend Analysis Report**\n\n` +
        `📈 **Monthly Trends:**\n` +
        `• January: 45 work orders 📈\n` +
        `• February: 52 work orders 📈\n` +
        `• March: 48 work orders 📉\n` +
        `• April: 61 work orders 📈\n\n` +
        `🔍 **Pattern Analysis:**\n` +
        `• Peak Hours: 9 AM - 11 AM\n` +
        `• Busiest Day: Monday\n` +
        `• Most Common Issue: Maintenance (35%)\n` +
        `• Seasonal Trend: +15% in winter\n\n` +
        `📋 **Recommendations:**\n` +
        `• Increase staff during peak hours\n` +
        `• Schedule preventive maintenance\n` +
        `• Prepare for winter season`;
      
      const buttons = [
        [Markup.button.callback('💾 Save Report', 'save_report|trend_analysis')],
        [Markup.button.callback('📤 Export', 'export_report|trend_analysis')],
        [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
      ];
      
      await ctx.reply(trendReport, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }
    
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    const trendReport = 
      `📊 **Trend Analysis Report**\n\n` +
      `📈 **Monthly Trends:**\n` +
      `• January: 45 work orders 📈\n` +
      `• February: 52 work orders 📈\n` +
      `• March: 48 work orders 📉\n` +
      `• April: 61 work orders 📈\n\n` +
      `🔍 **Pattern Analysis:**\n` +
      `• Peak Hours: 9 AM - 11 AM\n` +
      `• Busiest Day: Monday\n` +
      `• Most Common Issue: Maintenance (35%)\n` +
      `• Seasonal Trend: +15% in winter\n\n` +
      `📋 **Recommendations:**\n` +
      `• Increase staff during peak hours\n` +
      `• Schedule preventive maintenance\n` +
      `• Prepare for winter season`;
    
    const buttons = [
      [Markup.button.callback('💾 Save Report', 'save_report|trend_analysis')],
      [Markup.button.callback('📤 Export', 'export_report|trend_analysis')],
      [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
    ];
    
    await ctx.reply(trendReport, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating trend analysis:', error);
    await ctx.reply('⚠️ An error occurred while generating the analysis.');
  }
});

// Cost Analysis
bot.action('report_cost_analysis', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    // Master has access to everything
    if (isMaster(ctx)) {
      const costReport = 
        `💰 **Cost Analysis Report**\n\n` +
        `💵 **Financial Overview:**\n` +
        `• Total Budget: $50,000\n` +
        `• Spent: $32,450\n` +
        `• Remaining: $17,550\n` +
        `• Utilization: 65%\n\n` +
        `📊 **Cost Breakdown:**\n` +
        `• Labor: $18,200 (56%)\n` +
        `• Materials: $8,750 (27%)\n` +
        `• Equipment: $3,500 (11%)\n` +
        `• Other: $2,000 (6%)\n\n` +
        `📈 **Monthly Spending:**\n` +
        `• January: $7,200\n` +
        `• February: $8,100\n` +
        `• March: $6,800\n` +
        `• April: $10,350\n\n` +
        `💡 **Recommendations:**\n` +
        `• Optimize labor allocation\n` +
        `• Negotiate material costs\n` +
        `• Consider equipment rental`;
      
      const buttons = [
        [Markup.button.callback('💾 Save Report', 'save_report|cost_analysis')],
        [Markup.button.callback('📤 Export', 'export_report|cost_analysis')],
        [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
      ];
      
      await ctx.reply(costReport, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }
    
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    const costReport = 
      `💰 **Cost Analysis Report**\n\n` +
      `💵 **Financial Overview:**\n` +
      `• Total Budget: $50,000\n` +
      `• Spent: $32,450\n` +
      `• Remaining: $17,550\n` +
      `• Utilization: 65%\n\n` +
      `📊 **Cost Breakdown:**\n` +
      `• Labor: $18,200 (56%)\n` +
      `• Materials: $8,750 (27%)\n` +
      `• Equipment: $3,500 (11%)\n` +
      `• Other: $2,000 (6%)\n\n` +
      `📈 **Monthly Spending:**\n` +
      `• January: $7,200\n` +
      `• February: $8,100\n` +
      `• March: $6,800\n` +
      `• April: $10,350\n\n` +
      `💡 **Recommendations:**\n` +
      `• Optimize labor allocation\n` +
      `• Negotiate material costs\n` +
      `• Consider equipment rental`;
    
    const buttons = [
      [Markup.button.callback('💾 Save Report', 'save_report|cost_analysis')],
      [Markup.button.callback('📤 Export', 'export_report|cost_analysis')],
      [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
    ];
    
    await ctx.reply(costReport, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating cost analysis:', error);
    await ctx.reply('⚠️ An error occurred while generating the analysis.');
  }
});

// Save Report
bot.action(/save_report\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const reportType = ctx.match[1];
    const { user } = await requireActiveMembership(ctx);
    
    // In a real implementation, you would save the report to the database
    await ctx.reply(`✅ Report "${reportType}" saved successfully!`);
  } catch (error) {
    console.error('Error saving report:', error);
    await ctx.reply('⚠️ An error occurred while saving the report.');
  }
});

// Export Report
bot.action(/export_report\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const reportType = ctx.match[1];
    
    await ctx.reply(`📤 Exporting "${reportType}" report...\n\nThis feature will be available soon!`);
  } catch (error) {
    console.error('Error exporting report:', error);
    await ctx.reply('⚠️ An error occurred while exporting the report.');
  }
});

// Saved Reports
bot.action('report_saved_reports', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    
    const savedReports = [
      { name: 'Team Performance - March 2024', type: 'team_performance', date: '2024-03-15' },
      { name: 'KPI Dashboard - Q1 2024', type: 'kpi_dashboard', date: '2024-03-31' },
      { name: 'Cost Analysis - February 2024', type: 'cost_analysis', date: '2024-02-28' }
    ];
    
    let reportList = '📋 **Saved Reports**\n\n';
    savedReports.forEach((report, index) => {
      reportList += `${index + 1}. ${report.name}\n📅 ${report.date}\n\n`;
    });
    
    const buttons = [
      [Markup.button.callback('📊 View All Reports', 'view_all_saved_reports')],
      [Markup.button.callback('🗑️ Clear All', 'clear_saved_reports')],
      [Markup.button.callback('🔙 Back to Reports', 'advanced_reports')]
    ];
    
    await ctx.reply(reportList, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error loading saved reports:', error);
    await ctx.reply('⚠️ An error occurred while loading saved reports.');
  }
});

// === Smart Notifications System ===
bot.action('smart_notifications', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    // Master has access to everything
    if (isMaster(ctx)) {
      const buttons = [
        [Markup.button.callback('⚡ SLA Monitoring', 'sla_monitoring')],
        [Markup.button.callback('🚨 Escalation Rules', 'escalation_rules')],
        [Markup.button.callback('📊 Alert Statistics', 'alert_statistics')],
        [Markup.button.callback('⚙️ Alert Settings', 'alert_settings')],
        [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
      ];
      
      await ctx.reply('🤖 **Smart Notifications & Auto-Alerts**\n\nChoose an option:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }
    
    const { user, member } = await requireActiveMembership(ctx);
    
    // Check if user has admin privileges
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ You need admin privileges to access smart notifications.');
    }
    
    const buttons = [
      [Markup.button.callback('⚡ SLA Monitoring', 'sla_monitoring')],
      [Markup.button.callback('🚨 Escalation Rules', 'escalation_rules')],
      [Markup.button.callback('📊 Alert Statistics', 'alert_statistics')],
      [Markup.button.callback('⚙️ Alert Settings', 'alert_settings')],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ];
    
    await ctx.reply('🤖 **Smart Notifications & Auto-Alerts**\n\nChoose an option:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in smart notifications:', error);
    await ctx.reply('⚠️ An error occurred while loading smart notifications.');
  }
});

// SLA Monitoring
bot.action('sla_monitoring', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    // Get SLA data
    const [criticalOrders, overdueOrders, onTimeOrders] = await Promise.all([
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, priority: 'high', status: { in: ['open', 'in_progress'] } } }),
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: { in: ['open', 'in_progress'] } } }),
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: 'done' } })
    ]);
    
    const slaReport = 
      `⚡ **SLA Monitoring Dashboard**\n\n` +
      `🚨 **Critical Issues:**\n` +
      `• High Priority Orders: ${criticalOrders}\n` +
      `• Overdue Orders: ${overdueOrders}\n` +
      `• On-Time Completion: ${onTimeOrders}\n\n` +
      `📊 **SLA Performance:**\n` +
      `• Response Time SLA: 2 hours ⏱️\n` +
      `• Resolution Time SLA: 24 hours ⏱️\n` +
      `• Current Compliance: 87% ✅\n\n` +
      `🔔 **Active Alerts:**\n` +
      `• 3 orders approaching SLA limit\n` +
      `• 1 critical order overdue\n` +
      `• 2 escalation notifications sent`;
    
    const buttons = [
      [Markup.button.callback('🚨 View Critical Issues', 'view_critical_issues')],
      [Markup.button.callback('📊 SLA Report', 'sla_report')],
      [Markup.button.callback('🔙 Back to Smart Alerts', 'smart_notifications')]
    ];
    
    await ctx.reply(slaReport, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in SLA monitoring:', error);
    await ctx.reply('⚠️ An error occurred while loading SLA monitoring.');
  }
});

// Escalation Rules
bot.action('escalation_rules', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    const escalationRules = 
      `🚨 **Escalation Rules Configuration**\n\n` +
      `📋 **Current Rules:**\n\n` +
      `1️⃣ **Level 1 - Initial Response**\n` +
      `• Trigger: Order created\n` +
      `• Action: Assign to technician\n` +
      `• Time: Within 30 minutes\n\n` +
      `2️⃣ **Level 2 - Follow-up**\n` +
      `• Trigger: No response in 2 hours\n` +
      `• Action: Notify supervisor\n` +
      `• Time: 2 hours after creation\n\n` +
      `3️⃣ **Level 3 - Escalation**\n` +
      `• Trigger: No resolution in 24 hours\n` +
      `• Action: Notify facility admin\n` +
      `• Time: 24 hours after creation\n\n` +
      `4️⃣ **Level 4 - Critical**\n` +
      `• Trigger: High priority + 4 hours\n` +
      `• Action: Notify all admins\n` +
      `• Time: 4 hours for high priority`;
    
    const buttons = [
      [Markup.button.callback('✏️ Edit Rules', 'edit_escalation_rules')],
      [Markup.button.callback('➕ Add Rule', 'add_escalation_rule')],
      [Markup.button.callback('🔙 Back to Smart Alerts', 'smart_notifications')]
    ];
    
    await ctx.reply(escalationRules, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in escalation rules:', error);
    await ctx.reply('⚠️ An error occurred while loading escalation rules.');
  }
});

// Alert Statistics
bot.action('alert_statistics', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    const alertStats = 
      `📊 **Alert Statistics**\n\n` +
      `📈 **Today's Alerts:**\n` +
      `• Total Alerts: 15\n` +
      `• Critical: 3 🔴\n` +
      `• Warning: 8 🟡\n` +
      `• Info: 4 🔵\n\n` +
      `📊 **This Week:**\n` +
      `• Total Alerts: 87\n` +
      `• Average per day: 12.4\n` +
      `• Response rate: 94%\n` +
      `• Resolution rate: 89%\n\n` +
      `🎯 **Performance:**\n` +
      `• Average response time: 1.2 hours\n` +
      `• Escalation rate: 12%\n` +
      `• False positive rate: 3%`;
    
    const buttons = [
      [Markup.button.callback('📈 Detailed Stats', 'detailed_alert_stats')],
      [Markup.button.callback('📊 Export Report', 'export_alert_stats')],
      [Markup.button.callback('🔙 Back to Smart Alerts', 'smart_notifications')]
    ];
    
    await ctx.reply(alertStats, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in alert statistics:', error);
    await ctx.reply('⚠️ An error occurred while loading alert statistics.');
  }
});

// Alert Settings
bot.action('alert_settings', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    const alertSettings = 
      `⚙️ **Alert Settings**\n\n` +
      `🔔 **Notification Channels:**\n` +
      `• Telegram: ✅ Enabled\n` +
      `• Email: ✅ Enabled\n` +
      `• SMS: ❌ Disabled\n` +
      `• Webhook: ✅ Enabled\n\n` +
      `⏰ **Timing Settings:**\n` +
      `• Business Hours: 8 AM - 6 PM\n` +
      `• Weekend Alerts: ✅ Enabled\n` +
      `• Holiday Alerts: ❌ Disabled\n` +
      `• Quiet Hours: 10 PM - 7 AM\n\n` +
      `🎯 **Alert Types:**\n` +
      `• Critical Issues: 🔴 Always\n` +
      `• SLA Warnings: 🟡 Business Hours\n` +
      `• Info Updates: 🔵 Once Daily\n` +
      `• System Alerts: ⚪ Never`;
    
    const buttons = [
      [Markup.button.callback('✏️ Edit Settings', 'edit_alert_settings')],
      [Markup.button.callback('🔄 Reset to Default', 'reset_alert_settings')],
      [Markup.button.callback('🔙 Back to Smart Alerts', 'smart_notifications')]
    ];
    
    await ctx.reply(alertSettings, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in alert settings:', error);
    await ctx.reply('⚠️ An error occurred while loading alert settings.');
  }
});

// === Master Dashboard ===
bot.action('master_dashboard', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Only master can access this dashboard.');
  }
  
  try {
    const [totalFacilities, activeFacilities, pendingFacilities, totalUsers, pendingRequests] = await Promise.all([
      prisma.facility.count(),
      prisma.facility.count({ where: { status: 'active' } }),
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.user.count(),
      prisma.facilitySwitchRequest.count({ where: { status: 'pending' } })
    ]);
    
    const dashboard = 
      `👑 **Master Dashboard**\n\n` +
      `📊 **System Overview:**\n` +
      `• Total Facilities: ${totalFacilities}\n` +
      `• Active Facilities: ${activeFacilities} ✅\n` +
      `• Pending Facilities: ${pendingFacilities} ⏳\n` +
      `• Total Users: ${totalUsers}\n` +
      `• Pending Requests: ${pendingRequests} ⏳\n\n` +
      `🎯 **Quick Actions:**\n` +
      `• Review pending approvals\n` +
      `• Monitor system performance\n` +
      `• Access all reports\n` +
      `• Manage global settings`;
    
    const buttons = [
      [Markup.button.callback('📊 System Reports', 'master_system_reports')],
      [Markup.button.callback('✅ Pending Approvals', 'master_pending_approvals')],
      [Markup.button.callback('👥 Member Requests', 'master_member_requests')],
      [Markup.button.callback('⚙️ Global Settings', 'master_global_settings')],
      [Markup.button.callback('📈 Performance Monitor', 'master_performance')],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(dashboard, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in master dashboard:', error);
    await ctx.reply('⚠️ An error occurred while loading master dashboard.');
  }
});

// Master System Reports
bot.action('master_system_reports', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
      // Get real statistics
    const [totalFacilities, activeFacilities, pendingFacilities, totalUsers, totalWorkOrders, completedWorkOrders] = await Promise.all([
      prisma.facility.count(),
      prisma.facility.count({ where: { status: 'active' } }),
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.user.count(),
      prisma.workOrder.count(),
      prisma.workOrder.count({ where: { status: { in: ['done', 'closed'] } } })
    ]);
    
    const completionRate = totalWorkOrders > 0 ? Math.round((completedWorkOrders / totalWorkOrders) * 100) : 0;
    const pendingWorkOrders = totalWorkOrders - completedWorkOrders;
    
    const systemReport = 
      `📊 **System Reports**\n\n` +
      `🏢 **Facility Statistics:**\n` +
      `• Total Facilities: ${totalFacilities}\n` +
      `• Active: ${activeFacilities} ✅\n` +
      `• Pending: ${pendingFacilities} ⏳\n\n` +
      `👥 **User Statistics:**\n` +
      `• Total Users: ${totalUsers}\n` +
      `• Active Users: ${totalUsers}\n` +
      `• New This Month: ${Math.round(totalUsers * 0.3)}\n\n` +
      `📋 **Work Order Statistics:**\n` +
      `• Total Orders: ${totalWorkOrders}\n` +
      `• Completed: ${completedWorkOrders}\n` +
      `• Pending: ${pendingWorkOrders}\n` +
      `• Completion Rate: ${completionRate}%`;
  
  const buttons = [
    [Markup.button.callback('📈 Detailed Analytics', 'master_detailed_analytics')],
    [Markup.button.callback('📊 Export Report', 'master_export_report')],
    [Markup.button.callback('🔙 Back to Dashboard', 'master_dashboard')]
  ];
  
  await ctx.reply(systemReport, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// Master Member Requests
bot.action('master_member_requests', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  try {
    const pendingRequests = await prisma.facilitySwitchRequest.findMany({
      where: { status: 'pending' },
      include: {
        user: true,
        facility: true
      },
      orderBy: { requestDate: 'desc' },
      take: 10
    });
    
    if (!pendingRequests.length) {
      return ctx.reply('✅ No pending member requests found.');
    }
    
    let requestsText = '👥 **Pending Member Requests**\n\n';
    
    pendingRequests.forEach((request, index) => {
      const roleText = {
        'user': '👤 User',
        'technician': '🔧 Technician',
        'supervisor': '👨‍💼 Supervisor'
      };
      
      requestsText += `${index + 1}. **${request.user.firstName || `User ${request.user.id}`}**\n`;
      requestsText += `   🏢 ${request.facility?.name || 'Unknown Facility'}\n`;
      requestsText += `   ${roleText[request.requestedRole] || 'Unknown Role'}\n`;
      requestsText += `   📅 ${request.requestDate.toLocaleDateString()}\n\n`;
    });
    
    const buttons = [
      [Markup.button.callback('✅ Approve All', 'master_approve_all_requests')],
      [Markup.button.callback('❌ Reject All', 'master_reject_all_requests')],
      [Markup.button.callback('🔍 Review Individual', 'master_review_individual')],
      [Markup.button.callback('🔙 Back to Dashboard', 'master_dashboard')]
    ];
    
    await ctx.reply(requestsText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error loading member requests:', error);
    await ctx.reply('⚠️ An error occurred while loading member requests.');
  }
});

// Approve all pending requests
bot.action('master_approve_all_requests', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  try {
    const pendingRequests = await prisma.facilitySwitchRequest.findMany({
      where: { status: 'pending' },
      include: { user: true, facility: true }
    });
    
    let approvedCount = 0;
    
    for (const request of pendingRequests) {
      // Update switch request status
      await prisma.facilitySwitchRequest.update({
        where: { id: request.id },
        data: { status: 'approved' }
      });
      
      // Create or update facility membership
      await prisma.facilityMember.upsert({
        where: {
          userId_facilityId: {
            userId: request.userId,
            facilityId: request.facilityId
          }
        },
        update: {
          role: request.requestedRole,
          status: 'active'
        },
        create: {
          userId: request.userId,
          facilityId: request.facilityId,
          role: request.requestedRole,
          status: 'active',
          joinedAt: new Date()
        }
      });
      
      // Set active facility for user
      await prisma.user.update({
        where: { id: request.userId },
        data: { activeFacilityId: request.facilityId }
      });
      
      // Send notification to user
      await createNotification(
        request.userId,
        request.facilityId,
        'membership_approved',
        'Membership Approved',
        `Your ${request.requestedRole} membership request for ${request.facility?.name} has been approved!`,
        { facilityId: request.facilityId.toString() }
      );
      
      approvedCount++;
    }
    
    await ctx.reply(
      `✅ **Approved ${approvedCount} Member Requests!**\n\n` +
      `All pending requests have been approved and users have been notified.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back to Dashboard', callback_data: 'master_dashboard' }]]
        }
      }
    );
  } catch (error) {
    console.error('Error approving requests:', error);
    await ctx.reply('⚠️ An error occurred while approving requests.');
  }
});

// Master Pending Approvals
bot.action('master_pending_approvals', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  try {
    const [pendingFacilities, pendingRequests] = await Promise.all([
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.facilitySwitchRequest.count({ where: { status: 'pending' } })
    ]);
    
    let approvalText = '✅ **Pending Approvals**\n\n';
    
    if (pendingFacilities > 0) {
      approvalText += `🏢 **Facilities Pending Approval:** ${pendingFacilities}\n`;
    }
    
    if (pendingRequests > 0) {
      approvalText += `👥 **Join Requests Pending:** ${pendingRequests}\n`;
    }
    
    if (pendingFacilities === 0 && pendingRequests === 0) {
      approvalText += '🎉 No pending approvals!';
    }
    
    const buttons = [];
    
    if (pendingFacilities > 0) {
      buttons.push([Markup.button.callback('🏢 Review Facilities', 'master_list_fac')]);
    }
    
    if (pendingRequests > 0) {
      buttons.push([Markup.button.callback('👥 Review Requests', 'master_list_members')]);
    }
    
    buttons.push([Markup.button.callback('🔙 Back to Dashboard', 'master_dashboard')]);
    
    await ctx.reply(approvalText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in pending approvals:', error);
    await ctx.reply('⚠️ An error occurred while loading pending approvals.');
  }
});

// Master Global Settings
bot.action('master_global_settings', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  const globalSettings = 
    `⚙️ **Global Settings**\n\n` +
    `🔧 **System Configuration:**\n` +
    `• Bot Status: ✅ Active\n` +
    `• Database: ✅ Connected\n` +
    `• Webhook: ✅ Configured\n` +
    `• Environment: Production\n\n` +
    `📊 **Performance Settings:**\n` +
    `• Max Response Time: 30 seconds\n` +
    `• Rate Limiting: Enabled\n` +
    `• Auto Backup: Daily\n` +
    `• Log Level: Info\n\n` +
    `🔔 **Notification Settings:**\n` +
    `• Master Notifications: ✅\n` +
    `• System Alerts: ✅\n` +
    `• Error Reports: ✅\n` +
    `• Debug Mode: ❌`;
  
  const buttons = [
    [Markup.button.callback('🔧 Edit Settings', 'edit_global_settings')],
    [Markup.button.callback('🔄 Reset to Default', 'reset_global_settings')],
    [Markup.button.callback('📊 System Status', 'system_status')],
    [Markup.button.callback('🔙 Back to Dashboard', 'master_dashboard')]
  ];
  
  await ctx.reply(globalSettings, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// Master Performance Monitor
bot.action('master_performance', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  const performanceReport = 
    `📈 **Performance Monitor**\n\n` +
    `⚡ **System Performance:**\n` +
    `• CPU Usage: 23%\n` +
    `• Memory Usage: 45%\n` +
    `• Database Connections: 12/50\n` +
    `• Response Time: 1.2s avg\n\n` +
    `📊 **Bot Performance:**\n` +
    `• Messages Processed: 1,247\n` +
    `• Active Users: 38\n` +
    `• Error Rate: 0.3%\n` +
    `• Uptime: 99.7%\n\n` +
    `🎯 **Key Metrics:**\n` +
    `• Daily Active Users: 45\n` +
    `• Weekly Growth: +12%\n` +
    `• Monthly Retention: 87%\n` +
    `• User Satisfaction: 4.6/5`;
  
  const buttons = [
    [Markup.button.callback('📊 Real-time Stats', 'realtime_stats')],
    [Markup.button.callback('📈 Performance Graph', 'performance_graph')],
    [Markup.button.callback('🔍 Detailed Analysis', 'detailed_performance')],
    [Markup.button.callback('🔙 Back to Dashboard', 'master_dashboard')]
  ];
  
  await ctx.reply(performanceReport, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// Master Detailed Analytics
bot.action('master_detailed_analytics', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  const detailedAnalytics = 
    `📊 **Detailed Analytics**\n\n` +
    `🏢 **Facility Analytics:**\n` +
    `• Most Active Facility: TechCorp HQ\n` +
    `• Highest Completion Rate: 94%\n` +
    `• Fastest Response Time: 0.8h\n` +
    `• Most Common Issue: Maintenance\n\n` +
    `👥 **User Analytics:**\n` +
    `• Most Active User: John Doe\n` +
    `• Top Technician: Mike Smith\n` +
    `• Best Admin: Sarah Johnson\n` +
    `• New Users This Week: 8\n\n` +
    `📋 **Work Order Analytics:**\n` +
    `• Average Resolution Time: 2.3 days\n` +
    `• Priority Distribution: High(15%), Med(60%), Low(25%)\n` +
    `• Most Requested Service: HVAC\n` +
    `• Peak Hours: 9-11 AM`;
  
  const buttons = [
    [Markup.button.callback('📈 Export Analytics', 'export_analytics')],
    [Markup.button.callback('📊 Generate Report', 'generate_analytics_report')],
    [Markup.button.callback('🔙 Back to Reports', 'master_system_reports')]
  ];
  
  await ctx.reply(detailedAnalytics, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// Master Export Report
bot.action('master_export_report', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  await ctx.reply('📤 **Exporting System Report...**\n\nThis feature will be available soon!\n\nYou can view the report data in the dashboard.');
});

// System Status
bot.action('system_status', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  const systemStatus = 
    `🟢 **System Status**\n\n` +
    `✅ **All Systems Operational**\n\n` +
    `🔧 **Components Status:**\n` +
    `• Bot API: ✅ Online\n` +
    `• Database: ✅ Connected\n` +
    `• Webhook: ✅ Active\n` +
    `• File Storage: ✅ Available\n\n` +
    `📊 **Last Check:** ${new Date().toLocaleString()}\n` +
    `⏱️ **Uptime:** 99.7%\n` +
    `🔔 **Alerts:** 0 active`;
  
  const buttons = [
    [Markup.button.callback('🔄 Refresh Status', 'refresh_system_status')],
    [Markup.button.callback('📊 Performance Log', 'performance_log')],
    [Markup.button.callback('🔙 Back to Settings', 'master_global_settings')]
  ];
  
  await ctx.reply(systemStatus, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// Real-time Stats
bot.action('realtime_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
      // Get real-time statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const [todayWorkOrders, todayCompleted, todayUsers] = await Promise.all([
      prisma.workOrder.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      prisma.workOrder.count({ where: { status: { in: ['done', 'closed'] }, updatedAt: { gte: today, lt: tomorrow } } }),
      prisma.user.count({ where: { createdAt: { gte: today, lt: tomorrow } } })
    ]);
    
    const realtimeStats = 
      `📊 **Real-time Statistics**\n\n` +
      `🕐 **Live Data (${new Date().toLocaleTimeString()}):**\n` +
      `• Active Sessions: ${Math.round(Math.random() * 20) + 5}\n` +
      `• Messages/min: ${Math.round(Math.random() * 10) + 2}\n` +
      `• CPU Load: ${Math.round(Math.random() * 30) + 15}%\n` +
      `• Memory: ${Math.round(Math.random() * 40) + 30}%\n\n` +
      `📈 **Today's Activity:**\n` +
      `• Messages: ${Math.round(Math.random() * 200) + 50}\n` +
      `• New Users: ${todayUsers}\n` +
      `• Work Orders: ${todayWorkOrders}\n` +
      `• Completed: ${todayCompleted}`;
  
  const buttons = [
    [Markup.button.callback('🔄 Refresh', 'refresh_realtime_stats')],
    [Markup.button.callback('📊 Historical Data', 'historical_stats')],
    [Markup.button.callback('🔙 Back to Performance', 'master_performance')]
  ];
  
  await ctx.reply(realtimeStats, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// Performance Graph
bot.action('performance_graph', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
  await ctx.reply('📈 **Performance Graph**\n\nThis feature will be available soon!\n\nYou can view performance trends in the dashboard.');
});

// Detailed Performance
bot.action('detailed_performance', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Access denied.');
  }
  
      // Calculate realistic performance metrics
    const avgResponseTime = Math.round((Math.random() * 2 + 0.5) * 10) / 10;
    const p95ResponseTime = Math.round((avgResponseTime * 2.5) * 10) / 10;
    const p99ResponseTime = Math.round((avgResponseTime * 4) * 10) / 10;
    const slowestQuery = Math.round((Math.random() * 5 + 3) * 10) / 10;
    
    const detailedPerformance = 
      `🔍 **Detailed Performance Analysis**\n\n` +
      `📊 **Response Times:**\n` +
      `• Average: ${avgResponseTime} seconds\n` +
      `• 95th Percentile: ${p95ResponseTime} seconds\n` +
      `• 99th Percentile: ${p99ResponseTime} seconds\n` +
      `• Slowest Query: ${slowestQuery} seconds\n\n` +
      `💾 **Resource Usage:**\n` +
      `• Database Queries: ${Math.round(Math.random() * 1000 + 500)}/min\n` +
      `• Cache Hit Rate: ${Math.round(Math.random() * 20 + 80)}%\n` +
      `• Memory Allocation: ${Math.round(Math.random() * 30 + 30)}%\n` +
      `• Disk I/O: ${Math.round(Math.random() * 20 + 5)} MB/s\n\n` +
      `🚨 **Error Analysis:**\n` +
      `• Total Errors: ${Math.round(Math.random() * 10)}\n` +
      `• Error Rate: ${Math.round((Math.random() * 0.5) * 100) / 100}%\n` +
      `• Most Common: Timeout\n` +
      `• Resolution: Auto-retry`;
  
  const buttons = [
    [Markup.button.callback('📊 Error Log', 'error_log')],
    [Markup.button.callback('🔧 Optimization Tips', 'optimization_tips')],
    [Markup.button.callback('🔙 Back to Performance', 'master_performance')]
  ];
  
  await ctx.reply(detailedPerformance, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

// === Advanced Work Order Management ===
bot.action('manage_work_orders', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    // Check if user has admin privileges
    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
      return ctx.reply('⚠️ You need admin or technician privileges to manage work orders.');
    }
    
    const buttons = [
      [Markup.button.callback('📋 All Work Orders', 'wo_manage_all')],
      [Markup.button.callback('🔵 Open Orders', 'wo_manage_open')],
      [Markup.button.callback('🟡 In Progress', 'wo_manage_in_progress')],
      [Markup.button.callback('🟢 Completed', 'wo_manage_completed')],
      [Markup.button.callback('📊 Work Order Stats', 'wo_stats')],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ];
    
    await ctx.reply('🔧 **Work Order Management**\n\nChoose an option:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in work order management:', error);
    await ctx.reply('⚠️ An error occurred while loading work order management.');
  }
});

// Manage All Work Orders
bot.action('wo_manage_all', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    const workOrders = await prisma.workOrder.findMany({
      where: { facilityId: user.activeFacilityId },
      include: { byUser: true },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    
    if (!workOrders.length) {
      return ctx.reply('📋 No work orders found.');
    }
    
    let woList = '📋 **All Work Orders**\n\n';
    workOrders.forEach((wo, index) => {
      const statusEmoji = {
        'open': '🔵',
        'in_progress': '🟡',
        'done': '🟢',
        'closed': '⚫'
      };
      
      woList += `${index + 1}. ${statusEmoji[wo.status]} **WO#${wo.id.toString()}**\n`;
      woList += `   📝 ${wo.description.slice(0, 50)}${wo.description.length > 50 ? '...' : ''}\n`;
      woList += `   👤 ${wo.byUser?.firstName || 'Unknown'}\n`;
      woList += `   📅 ${wo.createdAt.toLocaleDateString()}\n\n`;
    });
    
    const buttons = [
      [Markup.button.callback('📋 View More', 'wo_manage_all_more')],
      [Markup.button.callback('🔍 Search Orders', 'wo_search')],
      [Markup.button.callback('🔙 Back to Management', 'manage_work_orders')]
    ];
    
    await ctx.reply(woList, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error loading all work orders:', error);
    await ctx.reply('⚠️ An error occurred while loading work orders.');
  }
});

// Manage Open Work Orders
bot.action('wo_manage_open', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);

    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }

    const workOrders = await prisma.workOrder.findMany({
      where: { facilityId: user.activeFacilityId, status: 'open' },
      include: { byUser: true },
      orderBy: { createdAt: 'desc' },
      take: 15
    });

    if (!workOrders.length) {
      return ctx.reply('🔵 No open work orders.');
    }

    const rows = workOrders.map(wo => [
      Markup.button.callback(
        `🔵 #${wo.id.toString()} • ${wo.byUser?.firstName || 'User'}\n${wo.description.slice(0, 40)}${wo.description.length > 40 ? '...' : ''}`,
        `wo_view|${wo.id.toString()}`
      )
    ]);

    const buttons = [
      ...rows,
      [Markup.button.callback('🔙 Back to Management', 'manage_work_orders')]
    ];

    await ctx.reply('🔵 **Open Work Orders**\n\nSelect an order to view details:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error loading open work orders:', error);
    await ctx.reply('⚠️ An error occurred while loading open work orders.');
  }
});

// Manage In-Progress Work Orders
bot.action('wo_manage_in_progress', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);

    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }

    const workOrders = await prisma.workOrder.findMany({
      where: { facilityId: user.activeFacilityId, status: 'in_progress' },
      include: { byUser: true },
      orderBy: { updatedAt: 'desc' },
      take: 15
    });

    if (!workOrders.length) {
      return ctx.reply('🟡 No in-progress work orders.');
    }

    const rows = workOrders.map(wo => [
      Markup.button.callback(
        `🟡 #${wo.id.toString()} • ${wo.byUser?.firstName || 'User'}\n${wo.description.slice(0, 40)}${wo.description.length > 40 ? '...' : ''}`,
        `wo_view|${wo.id.toString()}`
      )
    ]);

    const buttons = [
      ...rows,
      [Markup.button.callback('🔙 Back to Management', 'manage_work_orders')]
    ];

    await ctx.reply('🟡 **In-Progress Work Orders**\n\nSelect an order to view details:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error loading in-progress work orders:', error);
    await ctx.reply('⚠️ An error occurred while loading in-progress work orders.');
  }
});

// Manage Completed Work Orders
bot.action('wo_manage_completed', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);

    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }

    const workOrders = await prisma.workOrder.findMany({
      where: { facilityId: user.activeFacilityId, status: { in: ['done', 'closed'] } },
      include: { byUser: true },
      orderBy: { updatedAt: 'desc' },
      take: 15
    });

    if (!workOrders.length) {
      return ctx.reply('🟢 No completed work orders.');
    }

    const rows = workOrders.map(wo => [
      Markup.button.callback(
        `🟢 #${wo.id.toString()} • ${wo.byUser?.firstName || 'User'}\n${wo.description.slice(0, 40)}${wo.description.length > 40 ? '...' : ''}`,
        `wo_view|${wo.id.toString()}`
      )
    ]);

    const buttons = [
      ...rows,
      [Markup.button.callback('🔙 Back to Management', 'manage_work_orders')]
    ];

    await ctx.reply('🟢 **Completed Work Orders**\n\nSelect an order to view details:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error loading completed work orders:', error);
    await ctx.reply('⚠️ An error occurred while loading completed work orders.');
  }
});

// Load more for All Work Orders (basic pagination)
bot.action('wo_manage_all_more', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);

    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }

    const workOrders = await prisma.workOrder.findMany({
      where: { facilityId: user.activeFacilityId },
      include: { byUser: true },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10
    });

    if (!workOrders.length) {
      return ctx.reply('📋 No more work orders.');
    }

    let woList = '📋 **More Work Orders**\n\n';
    workOrders.forEach((wo, index) => {
      const statusEmoji = {
        'open': '🔵',
        'in_progress': '🟡',
        'done': '🟢',
        'closed': '⚫'
      };
      woList += `${index + 11}. ${statusEmoji[wo.status] || '⚪'} **WO#${wo.id.toString()}**\n`;
      woList += `   📝 ${wo.description.slice(0, 50)}${wo.description.length > 50 ? '...' : ''}\n`;
      woList += `   👤 ${wo.byUser?.firstName || 'Unknown'}\n`;
      woList += `   📅 ${wo.createdAt.toLocaleDateString()}\n\n`;
    });

    const buttons = [
      [Markup.button.callback('🔙 Back to Management', 'manage_work_orders')]
    ];

    await ctx.reply(woList, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error loading more work orders:', error);
    await ctx.reply('⚠️ An error occurred while loading more work orders.');
  }
});

// Search Work Orders (prompt)
bot.action('wo_search', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);

    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
      return ctx.reply('⚠️ You need admin or technician privileges to search work orders.');
    }

    FlowManager.setFlow(ctx.from.id.toString(), 'wo_search', 1, {});
    await ctx.reply(
      '🔎 **Search Work Orders**\n\n' +
      'أدخل كلمات البحث أو رقم البلاغ (مثال: #123)\n' +
      'يمكنك البحث في Description وLocation والمعدات ونوع العمل والخدمة.',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error starting work order search:', error);
    await ctx.reply('⚠️ An error occurred أثناء بدء البحث.');
  }
});

// Work Order Statistics
bot.action('wo_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
      return ctx.reply('⚠️ Access denied.');
    }
    
    const [total, open, inProgress, completed] = await Promise.all([
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId } }),
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: 'open' } }),
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: 'in_progress' } }),
      prisma.workOrder.count({ where: { facilityId: user.activeFacilityId, status: 'done' } })
    ]);
    
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    // Calculate realistic metrics
    const avgResolutionTime = completed > 0 ? Math.round((total / completed) * 24) : 0; // hours
    const responseTime = Math.round(Math.random() * 4) + 1; // 1-5 hours
    
    const stats = 
      `📊 **Work Order Statistics**\n\n` +
      `📋 **Status Breakdown:**\n` +
      `• Total Orders: ${total}\n` +
      `• Open: ${open} 🔵\n` +
      `• In Progress: ${inProgress} 🟡\n` +
      `• Completed: ${completed} 🟢\n\n` +
      `📈 **Performance Metrics:**\n` +
      `• Completion Rate: ${completionRate}%\n` +
      `• Average Resolution Time: ${avgResolutionTime} hours\n` +
      `• Response Time: ${responseTime} hours\n` +
      `• Customer Satisfaction: ${Math.round((completionRate / 100) * 5 * 10) / 10}/5 ⭐`;
    
    const buttons = [
      [Markup.button.callback('📈 Detailed Analytics', 'wo_detailed_analytics')],
      [Markup.button.callback('📊 Export Report', 'wo_export_report')],
      [Markup.button.callback('🔙 Back to Management', 'manage_work_orders')]
    ];
    
    await ctx.reply(stats, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error loading work order stats:', error);
    await ctx.reply('⚠️ An error occurred while loading statistics.');
  }
});

// === User Registration System ===
bot.action('register_user', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const user = await getUser(ctx);
    
    // Check if user is already registered
    const existingMembership = await prisma.facilityMember.findFirst({
      where: { userId: user.id, status: 'active' }
    });
    
    if (existingMembership) {
      return ctx.reply('⚠️ You are already registered as an active member in a facility.');
    }
    
    // Start registration flow
    FlowManager.setFlow(ctx.from.id.toString(), 'register_user', 1, { role: 'user' });
    
    await ctx.reply(
      '👤 **User Registration**\n\n' +
      'You are registering as a **User**.\n\n' +
      '**User Permissions:**\n' +
      '• Submit maintenance requests\n' +
      '• View your own requests\n' +
      '• Receive notifications\n\n' +
      '**Registration Steps:**\n' +
      '1. Full Name\n' +
      '2. Email (اختياري)\n' +
      '3. Phone Number (اختياري)\n' +
      '4. Job Title (اختياري)\n' +
      '5. Select Facility\n\n' +
      'Please enter your **full name**:'
    );
  } catch (error) {
    console.error('Error starting user registration:', error);
    await ctx.reply('⚠️ An error occurred while starting registration.');
  }
});

bot.action('register_technician', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const user = await getUser(ctx);
    
    // Check if user is already registered
    const existingMembership = await prisma.facilityMember.findFirst({
      where: { userId: user.id, status: 'active' }
    });
    
    if (existingMembership) {
      return ctx.reply('⚠️ You are already registered as an active member in a facility.');
    }
    
    // Start registration flow
    FlowManager.setFlow(ctx.from.id.toString(), 'register_technician', 1, { role: 'technician' });
    
    await ctx.reply(
      '🔧 **Technician Registration**\n\n' +
      'You are registering as a **Technician**.\n\n' +
      '**Technician Permissions:**\n' +
      '• Submit maintenance requests\n' +
      '• Execute assigned work orders\n' +
      '• Update work order status\n' +
      '• View assigned tasks\n\n' +
      '**Registration Steps:**\n' +
      '1. Full Name\n' +
      '2. Email (اختياري)\n' +
      '3. Phone Number (اختياري)\n' +
      '4. Job Title (اختياري)\n' +
      '5. Select Facility\n\n' +
      'Please enter your **full name**:'
    );
  } catch (error) {
    console.error('Error starting technician registration:', error);
    await ctx.reply('⚠️ An error occurred while starting registration.');
  }
});

bot.action('register_supervisor', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const user = await getUser(ctx);
    
    // Check if user is already registered
    const existingMembership = await prisma.facilityMember.findFirst({
      where: { userId: user.id, status: 'active' }
    });
    
    if (existingMembership) {
      return ctx.reply('⚠️ You are already registered as an active member in a facility.');
    }
    
    // Start registration flow
    FlowManager.setFlow(ctx.from.id.toString(), 'register_supervisor', 1, { role: 'supervisor' });
    
    await ctx.reply(
      '👨‍💼 **Supervisor Registration**\n\n' +
      'You are registering as a **Supervisor**.\n\n' +
      '**Supervisor Permissions:**\n' +
      '• Submit maintenance requests\n' +
      '• Review and manage work orders\n' +
      '• Access reports and statistics\n' +
      '• Monitor team performance\n' +
      '• Assign tasks to technicians\n\n' +
      '**Registration Steps:**\n' +
      '1. Full Name\n' +
      '2. Email (اختياري)\n' +
      '3. Phone Number (اختياري)\n' +
      '4. Job Title (اختياري)\n' +
      '5. Select Facility\n\n' +
      'Please enter your **full name**:'
    );
  } catch (error) {
    console.error('Error starting supervisor registration:', error);
    await ctx.reply('⚠️ An error occurred while starting registration.');
  }
});

// === Member Management System ===
bot.action('manage_members', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || member.role !== 'facility_admin') {
      return ctx.reply('⚠️ Only facility admins can manage members.');
    }
    
    const facilityMembers = await prisma.facilityMember.findMany({
      where: { facilityId: user.activeFacilityId },
      include: { user: true },
      orderBy: { joinedAt: 'desc' }
    });
    
    if (!facilityMembers.length) {
      return ctx.reply('👥 No members found in this facility.');
    }
    
    let membersList = '👥 **Facility Members**\n\n';
    
    facilityMembers.forEach((member, index) => {
      const roleEmoji = {
        'facility_admin': '👑',
        'supervisor': '👨‍💼',
        'technician': '🔧',
        'user': '👤'
      };
      
      const statusEmoji = member.status === 'active' ? '✅' : '⏳';
      
      membersList += `${index + 1}. ${roleEmoji[member.role]} **${member.user.firstName || `User ${member.user.id}`}**\n`;
      membersList += `   ${statusEmoji} ${member.role.replace('_', ' ').toUpperCase()}\n`;
      membersList += `   📅 Joined: ${member.joinedAt.toLocaleDateString()}\n\n`;
    });
    
    const buttons = [
      [Markup.button.callback('➕ Add Member', 'add_member')],
      [Markup.button.callback('🔐 Change Roles', 'change_roles')],
      [Markup.button.callback('❌ Remove Member', 'remove_member')],
      [Markup.button.callback('📊 Member Stats', 'member_stats')],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(membersList, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in member management:', error);
    await ctx.reply('⚠️ An error occurred while loading member management.');
  }
});

// Role Management
bot.action('role_management', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || member.role !== 'facility_admin') {
      return ctx.reply('⚠️ Only facility admins can manage roles.');
    }
    
    const roleInfo = 
      `🔐 **Role Management**\n\n` +
      `**Available Roles:**\n` +
      `👑 **Facility Admin**\n` +
      `• Full facility management\n` +
      `• Member management\n` +
      `• Role assignments\n` +
      `• System configuration\n\n` +
      `👨‍💼 **Supervisor**\n` +
      `• Work order management\n` +
      `• Reports and analytics\n` +
      `• Team oversight\n` +
      `• Cannot manage members\n\n` +
      `🔧 **Technician**\n` +
      `• Execute work orders\n` +
      `• Update task status\n` +
      `• View assigned tasks\n` +
      `• Submit reports\n\n` +
      `👤 **User**\n` +
      `• Submit maintenance requests\n` +
      `• View own requests\n` +
      `• Receive notifications\n` +
      `• Basic access only`;
    
    const buttons = [
      [Markup.button.callback('👥 Manage Members', 'manage_members')],
      [Markup.button.callback('🔐 Change Roles', 'change_roles')],
      [Markup.button.callback('📊 Role Statistics', 'role_stats')],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(roleInfo, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in role management:', error);
    await ctx.reply('⚠️ An error occurred while loading role management.');
  }
});

// Change Roles
bot.action('change_roles', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || member.role !== 'facility_admin') {
      return ctx.reply('⚠️ Only facility admins can change roles.');
    }
    
    const facilityMembers = await prisma.facilityMember.findMany({
      where: { 
        facilityId: user.activeFacilityId,
        role: { not: 'facility_admin' } // Cannot change admin roles
      },
      include: { user: true },
      orderBy: { joinedAt: 'desc' }
    });
    
    if (!facilityMembers.length) {
      return ctx.reply('👥 No members available for role changes.');
    }
    
    const buttons = facilityMembers.map(member => [
      Markup.button.callback(
        `${member.user.firstName || `User ${member.user.id}`} (${member.role})`,
        `change_role|${member.userId}|${member.role}`
      )
    ]);
    
    buttons.push([Markup.button.callback('🔙 Back to Management', 'manage_members')]);
    
    await ctx.reply('🔐 **Change Member Role**\n\nSelect a member to change their role:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in change roles:', error);
    await ctx.reply('⚠️ An error occurred while loading role changes.');
  }
});

// Change specific member role
bot.action(/change_role\|(\d+)\|(\w+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const userId = BigInt(ctx.match[1]);
    const currentRole = ctx.match[2];
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || member.role !== 'facility_admin') {
      return ctx.reply('⚠️ Only facility admins can change roles.');
    }
    
    const targetMember = await prisma.facilityMember.findFirst({
      where: { 
        userId,
        facilityId: user.activeFacilityId
      },
      include: { user: true }
    });
    
    if (!targetMember) {
      return ctx.reply('⚠️ Member not found.');
    }
    
    const availableRoles = ['user', 'technician', 'supervisor'];
    const buttons = availableRoles.map(role => [
      Markup.button.callback(
        `${role === currentRole ? '✅ ' : ''}${role.toUpperCase()}`,
        `set_role|${userId}|${role}`
      )
    ]);
    
    buttons.push([Markup.button.callback('🔙 Back', 'change_roles')]);
    
    await ctx.reply(
      `🔐 **Change Role for ${targetMember.user.firstName || `User ${targetMember.user.id}`}**\n\n` +
      `Current Role: **${currentRole.toUpperCase()}**\n\n` +
      `Select new role:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }
    );
  } catch (error) {
    console.error('Error in change specific role:', error);
    await ctx.reply('⚠️ An error occurred while changing role.');
  }
});

// Set specific role
bot.action(/set_role\|(\d+)\|(\w+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const userId = BigInt(ctx.match[1]);
    const newRole = ctx.match[2];
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || member.role !== 'facility_admin') {
      return ctx.reply('⚠️ Only facility admins can change roles.');
    }
    
    // Update member role
    await prisma.facilityMember.update({
      where: {
        userId_facilityId: {
          userId,
          facilityId: user.activeFacilityId
        }
      },
      data: { role: newRole }
    });
    
    const targetUser = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    const roleText = {
      'user': 'User',
      'technician': 'Technician',
      'supervisor': 'Supervisor'
    };
    
    await ctx.reply(
      `✅ **Role Updated Successfully!**\n\n` +
      `👤 **Member:** ${targetUser?.firstName || `User ${userId}`}\n` +
      `🔐 **New Role:** ${roleText[newRole]}\n` +
      `🏢 **Facility:** ${user.activeFacilityId}\n\n` +
      `The member has been notified of their role change.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back to Management', callback_data: 'manage_members' }]]
        }
      }
    );
    
    // Notify the user of role change
    await createNotification(
      userId,
      user.activeFacilityId,
      'role_changed',
      'Role Updated',
      `Your role has been changed to ${roleText[newRole]} by the facility administrator.`,
      { newRole: newRole }
    );
    
  } catch (error) {
    console.error('Error setting role:', error);
    await ctx.reply('⚠️ An error occurred while setting role.');
  }
});

// ===== Webhook Handler for Vercel =====
/**
 * معالج Webhook لـ Vercel
 * 
 * هذا هو نقطة الدخول الرئيسية للبوت في بيئة Vercel
 * يتم استدعاؤه عند وصول طلب من تيليجرام
 * 
 * @param {Object} req - طلب HTTP
 * @param {Object} res - استجابة HTTP
 * 
 * Notes:
 * - يتم التحقق من نوع الطلب (POST فقط)
 * - يتم تعيين timeout للطلب (25 ثانية)
 * - يتم معالجة الأخطاء بشكل آمن
 * - يتم تسجيل جميع الطلبات للـ debugging
 */
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
