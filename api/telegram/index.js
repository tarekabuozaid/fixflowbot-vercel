/**
 * ============================================================================
 * FIXFLOW BOT - MAIN ENTRY POINT
 * ============================================================================
 * 
 * هذا الملف هو النقطة الرئيسية لبوت FixFlow لإدارة الصيانة
 * يحتوي على جميع الأوامر والمعالجات والفلوهات التفاعلية
 * 
 * الميزات الرئيسية:
 * - إدارة المنشآت والأعضاء
 * - إنشاء ومتابعة طلبات الصيانة
 * - نظام التقارير والإحصائيات
 * - إدارة التذكيرات والإشعارات
 * - نظام الأدوار والصلاحيات
 * 
 * البنية المعمارية:
 * - SecurityManager: إدارة الأمان والتحقق
 * - FlowManager: إدارة الفلوهات التفاعلية
 * - PlanManager: إدارة خطط الاشتراك
 * - ErrorHandler: معالجة الأخطاء المركزية
 * 
 * تاريخ آخر تحديث: 31 أغسطس 2025
 * المطور: Tarek Abu Ozaid
 * ============================================================================
 */

const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

// ===== استيراد الوحدات الجديدة (Modular Utilities) =====
// هذه الوحدات تم تطويرها حديثاً لتحسين الأمان والأداء
const SecurityManager = require('./utils/security');      // إدارة الأمان والتحقق
const FlowManager = require('./utils/flowManager');       // إدارة الفلوهات التفاعلية
const PlanManager = require('./utils/planManager');       // إدارة خطط الاشتراك
const ErrorHandler = require('./utils/errorHandler');     // معالجة الأخطاء المركزية

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
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Global error handler with security logging
bot.catch(async (err, ctx) => {
  const userId = ctx.from?.id || 'unknown';
  const username = ctx.from?.username || 'unknown';
  const chatId = ctx.chat?.id || 'unknown';
  
  console.error(`🚨 Global Error - User: ${userId} (@${username}), Chat: ${chatId}, Error:`, err);
  
  // Log security events
  if (err.message.includes('Rate limit') || err.message.includes('Invalid user') || err.message.includes('Insufficient permissions')) {
    console.warn(`🔒 Security Event - User ${userId} attempted unauthorized access`);
  }
  
  // Clear flow state on error to prevent getting stuck
  if (ctx.from?.id) {
    await FlowManager.clearFlow(ctx.from.id.toString());
  }
  
  ctx.reply('⚠️ An unexpected error occurred. Your current action has been cancelled. Please try again.').catch(() => {});
});

// Start command handler with enhanced error handling
bot.command('start', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user, isNew } = await SecurityManager.authenticateUser(ctx);
    console.log(`✅ Start command received from: ${user.tgId} (${user.firstName})`);
    
    if (isNew || !user.activeFacilityId) {
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
        `2. Start managing your maintenance tasks\n\n` +
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

// ===== دوال إدارة المستخدمين =====
/**
 * عرض القائمة الرئيسية للبوت
 * @param {Object} ctx - سياق طلب تيليجرام
 */
async function showMainMenu(ctx) {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    const buttons = [];
    
    if (user.status === 'active' && user.activeFacilityId) {
      // === MAIN MENU - 4 MAIN BUTTONS ===
      buttons.push([
        Markup.button.callback('🏠 Home', 'menu_home'),
        Markup.button.callback('📊 Reports', 'menu_reports')
      ]);
      
      buttons.push([
        Markup.button.callback('🔧 Work', 'menu_work'),
        Markup.button.callback('👑 Admin', 'menu_admin')
      ]);
      
      // === MASTER SECTION ===
      if (SecurityManager.validateMasterAccess(ctx)) {
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
    await ErrorHandler.handleError(error, ctx, 'showMainMenu');
  }
}

// Remove duplicate start handler - using bot.command('start') instead

// ===== الأوامر الرسمية مع الأمان =====

/**
 * أمر تسجيل منشأة جديدة
 * 
 * هذا الأمر يبدأ فلو تسجيل منشأة جديدة:
 * 1. اسم المنشأة (الخطوة 1/4)
 * 2. المدينة (الخطوة 2/4)
 * 3. رقم الهاتف (الخطوة 3/4)
 * 4. اختيار الخطة (الخطوة 4/4)
 * 
 * ملاحظات:
 * - يتم التحقق من الأمان عبر SecurityManager
 * - يتم إدارة الفلو عبر FlowManager
 * - يتم معالجة الأخطاء عبر ErrorHandler
 */
bot.command('registerfacility', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    await FlowManager.setFlow(user.tgId.toString(), 'reg_fac', 1, {});
    await ctx.reply('🏢 Facility Registration (1/4)\nPlease enter the facility name (max 60 chars):');
  }, ctx, 'registerfacility_command');
});

/**
 * أمر الانضمام لمنشأة
 * 
 * هذا الأمر يعرض قائمة المنشآت النشطة المتاحة للانضمام
 * المستخدم يمكنه اختيار منشأة والانضمام إليها
 * 
 * ملاحظات:
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
 * ملاحظات:
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
    const { facility } = await requireActiveMembership(ctx);
    
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
    await requireActiveMembership(ctx);
    await ctx.reply('👑 **Set Member Role**\n\nThis feature will be available soon!\n\nFor now, use the facility dashboard to manage members.');
  }, ctx, 'setrole_command');
});

// === Facility Registration Flow ===
bot.action('reg_fac_start', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    await FlowManager.setFlow(user.tgId.toString(), 'reg_fac', 1, {});
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
 * ملاحظات:
 * - يتم التحقق من الأمان عبر SecurityManager
 * - يتم معالجة الأخطاء عبر ErrorHandler
 * - يتم تنظيف أسماء المنشآت عبر SecurityManager.sanitizeInput
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
      `The facility administrator will review your request and approve it soon. You will receive a notification once approved.`,
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
      '2. Email (optional)\n' +
      '3. Phone Number (optional)\n' +
      '4. Job Title (optional)\n' +
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
    const { user } = await SecurityManager.authenticateUser(ctx);
    
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
    await ErrorHandler.handleError(error, ctx, 'switch_facility');
  }
});

// === Work Order Flow ===
bot.action('wo_new', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    try {
      await requireActiveMembership(ctx);
      
      // Create flow state using FlowManager
      await FlowManager.setFlow(ctx.from.id.toString(), 'wo_new', 1, {});
      
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
    } catch (error) {
      if (error.message === 'No active facility') {
        await ctx.reply(
          `⚠️ **No Active Facility**\n\n` +
          `You need to be a member of a facility to create work orders.\n\n` +
          `Please register or join a facility first.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback('🏢 Register Facility', 'reg_fac_start')],
                [Markup.button.callback('🔗 Join Facility', 'join_fac_start')],
                [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
              ]
            }
          }
        );
      } else {
        await ErrorHandler.handleError(error, ctx, 'wo_new');
      }
    }
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
 * - المستخدم نشط
 * 
 * ملاحظات:
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

// === Flow Handler for free text responses with security ===
bot.on('text', async (ctx, next) => {
  try {
    // Authenticate user first
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    const flowState = await FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState) return next();
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    // Sanitize input
    const text = ctx.message.text;
    
    // === FACILITY REGISTRATION FLOW ===
    if (flowState.flow === 'reg_fac') {
      try {
        // Step 1: Facility Name
        if (flowState.step === 1) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Facility registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedName = SecurityManager.sanitizeInput(text, 60);
          if (sanitizedName.length < 3) {
            return ctx.reply('⚠️ Facility name must be at least 3 characters. Try again or type /cancel to exit:');
          }
          
          await FlowManager.updateData(ctx.from.id.toString(), { name: sanitizedName });
          await FlowManager.updateStep(ctx.from.id.toString(), 2);
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `✅ **Facility Name:** ${updatedFlow.data.name}\n\n` +
            `🏙️ **Step 2/4: Enter the city**\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 2: City
        if (flowState.step === 2) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Facility registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedCity = SecurityManager.sanitizeInput(text, 50);
          if (sanitizedCity.length < 2) {
            return ctx.reply('⚠️ City must be at least 2 characters. Try again or type /cancel to exit:');
          }
          
          await FlowManager.updateData(ctx.from.id.toString(), { city: sanitizedCity });
          await FlowManager.updateStep(ctx.from.id.toString(), 3);
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `✅ **Facility Name:** ${updatedFlow.data.name}\n` +
            `✅ **City:** ${updatedFlow.data.city}\n\n` +
            `📞 **Step 3/4: Enter contact phone**\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 3: Phone
        if (flowState.step === 3) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Facility registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedPhone = SecurityManager.sanitizeInput(text, 20);
          if (!SecurityManager.validatePhone(sanitizedPhone)) {
            return ctx.reply('⚠️ Invalid phone number format. Please try again or type /cancel to exit:');
          }
          
          await FlowManager.updateData(ctx.from.id.toString(), { phone: sanitizedPhone });
          await FlowManager.updateStep(ctx.from.id.toString(), 4);
          
          const planButtons = [
            [Markup.button.callback('⭐ Free Plan', 'regfac_plan|Free')],
            [Markup.button.callback('🚀 Pro Plan', 'regfac_plan|Pro')],
            [Markup.button.callback('💎 Business Plan', 'regfac_plan|Business')],
            [{ text: '❌ Cancel', callback_data: 'regfac_cancel' }]
          ];
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `✅ **Facility Name:** ${updatedFlow.data.name}\n` +
            `✅ **City:** ${updatedFlow.data.city}\n` +
            `✅ **Phone:** ${updatedFlow.data.phone}\n\n` +
            `💼 **Step 4/4: Choose subscription plan**\n\n` +
            `**Free:** Up to 5 members, 50 work orders/month\n` +
            `**Pro:** Up to 20 members, 200 work orders/month\n` +
            `**Business:** Up to 100 members, 1000 work orders/month`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: planButtons }
            }
          );
        }
      } catch (error) {
        await ErrorHandler.handleError(error, ctx, 'reg_fac_flow');
      }
    }
    
    // === USER REGISTRATION FLOW (user, technician, supervisor) ===
    if (['register_user', 'register_technician', 'register_supervisor'].includes(flowState.flow)) {
      try {
        const roleText = {
          'register_user': 'User',
          'register_technician': 'Technician',
          'register_supervisor': 'Supervisor'
        };
        
        // Step 1: Full Name
        if (flowState.step === 1) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ User registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedName = SecurityManager.sanitizeInput(text, 100);
          if (!SecurityManager.validateName(sanitizedName)) {
            return ctx.reply('⚠️ Name must be at least 2 characters. Try again or type /cancel to exit:');
          }
          
          // Split name into first and last name
          const nameParts = sanitizedName.split(' ');
          await FlowManager.updateData(ctx.from.id.toString(), {
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(' ') || null,
            fullName: sanitizedName
          });
          await FlowManager.updateStep(ctx.from.id.toString(), 2);
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `✅ **Full Name:** ${updatedFlow.data.fullName}\n` +
            `✅ **Role:** ${roleText[flowState.flow]}\n\n` +
            `📧 **Step 2/5: Enter your email address**\n` +
            `Type /skip to skip, or /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 2: Email (optional)
        if (flowState.step === 2) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ User registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          if (text.toLowerCase() === '/skip') {
            await FlowManager.updateData(ctx.from.id.toString(), { email: null });
          } else {
            const sanitizedEmail = SecurityManager.sanitizeInput(text, 100);
            const validatedEmail = SecurityManager.validateEmail(sanitizedEmail);
            if (validatedEmail) {
              await FlowManager.updateData(ctx.from.id.toString(), { email: validatedEmail });
            } else {
              return ctx.reply('⚠️ Invalid email format. Please enter a valid email or type /skip to skip:');
            }
          }
          
          await FlowManager.updateStep(ctx.from.id.toString(), 3);
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `✅ **Full Name:** ${updatedFlow.data.fullName}\n` +
            `✅ **Role:** ${roleText[flowState.flow]}\n` +
            `✅ **Email:** ${updatedFlow.data.email || 'Not provided'}\n\n` +
            `📞 **Step 3/4: Enter your phone number**\n` +
            `Type /skip to skip, or /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 3: Phone (optional)
        if (flowState.step === 3) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ User registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          if (text.toLowerCase() === '/skip') {
            await FlowManager.updateData(ctx.from.id.toString(), { phone: null });
          } else {
            const sanitizedPhone = SecurityManager.sanitizeInput(text, 20);
            const validatedPhone = SecurityManager.validatePhone(sanitizedPhone);
            if (validatedPhone) {
              await FlowManager.updateData(ctx.from.id.toString(), { phone: validatedPhone });
            } else {
              return ctx.reply('⚠️ Invalid phone format. Please enter a valid phone number or type /skip to skip:');
            }
          }
          
          await FlowManager.updateStep(ctx.from.id.toString(), 4);
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `✅ **Full Name:** ${updatedFlow.data.fullName}\n` +
            `✅ **Role:** ${roleText[flowState.flow]}\n` +
            `✅ **Email:** ${updatedFlow.data.email || 'Not provided'}\n` +
            `✅ **Phone:** ${updatedFlow.data.phone || 'Not provided'}\n\n` +
            `💼 **Step 4/5: Enter your job title**\n` +
            `Type /skip to skip, or /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 4: Job Title (optional)
        if (flowState.step === 4) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ User registration cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          if (text.toLowerCase() === '/skip') {
            await FlowManager.updateData(ctx.from.id.toString(), { jobTitle: null });
          } else {
            const sanitizedJobTitle = SecurityManager.sanitizeInput(text, 50);
            if (sanitizedJobTitle.length < 2) {
              return ctx.reply('⚠️ Job title must be at least 2 characters. Try again or type /skip to skip:');
            }
            await FlowManager.updateData(ctx.from.id.toString(), { jobTitle: sanitizedJobTitle });
          }
          
          await FlowManager.updateStep(ctx.from.id.toString(), 5);
          
          // Show facility selection
          const facilities = await prisma.facility.findMany({
            where: { status: 'active' },
            orderBy: { name: 'asc' }
          });
          
          if (!facilities.length) {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('⚠️ No active facilities found. Please contact the system administrator.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const role = flowState.flow.split('_')[1];
          const buttons = facilities.map(f => [
            Markup.button.callback(f.name, `join_facility|${f.id}|${role}`)
          ]);
          buttons.push([{ text: '❌ Cancel', callback_data: 'user_reg_cancel' }]);
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `✅ **Full Name:** ${updatedFlow.data.fullName}\n` +
            `✅ **Role:** ${roleText[flowState.flow]}\n` +
            `✅ **Email:** ${updatedFlow.data.email || 'Not provided'}\n` +
            `✅ **Phone:** ${updatedFlow.data.phone || 'Not provided'}\n` +
            `✅ **Job Title:** ${updatedFlow.data.jobTitle || 'Not provided'}\n\n` +
            `🏢 **Step 5/5: Select Facility to Join**\n\n` +
            `Choose the facility you want to join as a ${roleText[flowState.flow]}.`,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: buttons }
            }
          );
        }
      } catch (error) {
        await ErrorHandler.handleError(error, ctx, 'user_reg_flow');
      }
    }
    
    // === WORK ORDER CREATION FLOW ===
    if (flowState.flow === 'wo_new') {
      try {
        // Step 4: Location
        if (flowState.step === 4) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Work order creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedLocation = SecurityManager.sanitizeInput(text, 100);
          if (sanitizedLocation.length < 3) {
            return ctx.reply('⚠️ Location must be at least 3 characters. Try again or type /cancel to exit:');
          }
          
          await FlowManager.updateData(ctx.from.id.toString(), { location: sanitizedLocation });
          await FlowManager.updateStep(ctx.from.id.toString(), 5);
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `🔧 **Work Order Creation (5/6)**\n\n` +
            `✅ **Type:** ${updatedFlow.data.typeOfWork}\n` +
            `✅ **Service:** ${updatedFlow.data.typeOfService}\n` +
            `✅ **Priority:** ${updatedFlow.data.priority}\n` +
            `✅ **Location:** ${sanitizedLocation}\n\n` +
            `🔧 **Enter equipment details (optional)**\n` +
            `(e.g., HVAC Unit #5, Electrical Panel B)\n\n` +
            `Type /skip to skip this step\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 5: Equipment (optional)
        if (flowState.step === 5) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Work order creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          if (text.toLowerCase() === '/skip') {
            await FlowManager.updateData(ctx.from.id.toString(), { equipment: null });
          } else {
            const sanitizedEquipment = SecurityManager.sanitizeInput(text, 100);
            if (sanitizedEquipment.length < 3) {
              return ctx.reply('⚠️ Equipment details must be at least 3 characters. Try again or type /skip to skip:');
            }
            await FlowManager.updateData(ctx.from.id.toString(), { equipment: sanitizedEquipment });
          }
          
          await FlowManager.updateStep(ctx.from.id.toString(), 6);
          
          const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
          return ctx.reply(
            `🔧 **Work Order Creation (6/6)**\n\n` +
            `✅ **Type:** ${updatedFlow.data.typeOfWork}\n` +
            `✅ **Service:** ${updatedFlow.data.typeOfService}\n` +
            `✅ **Priority:** ${updatedFlow.data.priority}\n` +
            `✅ **Location:** ${updatedFlow.data.location}\n` +
            `✅ **Equipment:** ${updatedFlow.data.equipment || 'Not provided'}\n\n` +
            `📝 **Enter a detailed description of the issue**\n` +
            `(e.g., "The AC unit is making a loud noise and not cooling.")\n\n` +
            `Type /cancel to exit`,
            { parse_mode: 'Markdown' }
          );
        }
        
        // Step 6: Description
        if (flowState.step === 6) {
          if (text.toLowerCase() === '/cancel') {
            await FlowManager.clearFlow(ctx.from.id.toString());
            return ctx.reply('❌ Work order creation cancelled.', {
              reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
            });
          }
          
          const sanitizedDescription = SecurityManager.sanitizeInput(text, 500);
          if (sanitizedDescription.length < 10) {
            return ctx.reply('⚠️ Description must be at least 10 characters. Try again or type /cancel to exit:');
          }
          
          await FlowManager.updateData(ctx.from.id.toString(), { description: sanitizedDescription });
          
          const finalFlow = await FlowManager.getFlow(ctx.from.id.toString());
          const data = finalFlow.data;
          
          // Final confirmation
          const confirmationText = 
            `📝 **Confirm New Work Order**\n\n` +
            `**Type:** ${data.typeOfWork}\n` +
            `**Service:** ${data.typeOfService}\n` +
            `**Priority:** ${data.priority}\n` +
            `**Location:** ${data.location}\n` +
            `**Equipment:** ${data.equipment || 'Not provided'}\n` +
            `**Description:** ${data.description}\n\n` +
            `Please confirm to create this work order.`;
            
          const confirmationButtons = [
            [Markup.button.callback('✅ Confirm', 'wo_confirm')],
            [Markup.button.callback('❌ Cancel', 'wo_cancel')]
          ];
          
          await ctx.reply(confirmationText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: confirmationButtons }
          });
        }
      } catch (error) {
        await ErrorHandler.handleError(error, ctx, 'wo_new_flow');
      }
    }
  } catch (error) {
    await ErrorHandler.handleError(error, ctx, 'text_handler');
  }
});

// ...existing code...
