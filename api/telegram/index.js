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
const WorkOrderController = require('./controllers/workOrderController');

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
    
    // Get facility membership
    const facilityUser = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        status: 'active'
      }
    });
    
    const facility = facilityUser ? await prisma.facility.findUnique({ where: { id: facilityUser.facilityId } }) : null;

    const welcomeMessage = facility 
      ? `👋 Welcome back to **${facility.name}**, ${user.firstName}!`
      : `👋 Welcome back, ${user.firstName}!`;

    const buttons = [];

    if (user.status === 'active' && facilityUser) {
      // --- Logged-in User with an Active Facility ---
      
      // Row 1: New Work Order (always visible for active users)
      buttons.push([Markup.button.callback('➕ New Work Order', 'wo_new')]);
      buttons.push([Markup.button.callback('✨ Enhanced Work Order', 'wo_enhanced_start')]);

      // Row 2: View Work Orders (different views by role)
      if (['supervisor', 'master', 'admin'].includes(facilityUser.role)) {
        buttons.push([Markup.button.callback('📋 View All Work Orders', 'wo_view_all')]);
      } else if (facilityUser.role === 'technician') {
        buttons.push([Markup.button.callback('📋 My Assigned Work Orders', 'wo_view_assigned')]);
      } else { // 'user' role
        buttons.push([Markup.button.callback('📋 My Work Orders', 'wo_view_my')]);
      }

      // Row 3: Admin & Reports (for privileged roles)
      const adminButtons = [];
      if (['admin', 'master', 'supervisor'].includes(facilityUser.role)) {
        adminButtons.push(Markup.button.callback('👑 Admin Panel', 'admin_panel'));
      }
      if (['admin', 'master', 'supervisor', 'technician'].includes(facilityUser.role)) {
         adminButtons.push(Markup.button.callback('📊 Reports', 'reports_panel'));
      }
       if (adminButtons.length > 0) {
        buttons.push(adminButtons);
      }

      // Row 4: Switch Facility & Settings
      const settingsButtons = [];
      settingsButtons.push(Markup.button.callback('⚙️ Settings', 'settings_panel'));
      const userFacilities = await prisma.facilityUser.count({ where: { userId: user.id } });
      if (userFacilities > 1) {
        settingsButtons.push(Markup.button.callback('🏢 Switch Facility', 'switch_facility_start'));
      }
      buttons.push(settingsButtons);

    } else {
      // --- New or Unaffiliated User ---
      buttons.push([
        Markup.button.callback('🏢 Register a New Facility', 'reg_fac_start'),
      ]);
      buttons.push([
        Markup.button.callback('🔗 Join an Existing Facility', 'join_fac_start'),
      ]);
    }

    // Final Row: Help button for everyone
    buttons.push([Markup.button.callback('❓ Help', 'help')]);
    
    const messagePayload = {
      text: `${welcomeMessage}\n\nHow can I help you today?`,
      options: {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      }
    };

    // Use editMessageText if it's a callback, otherwise reply
    if (ctx.callbackQuery) {
      await ctx.editMessageText(messagePayload.text, messagePayload.options);
    } else {
      await ctx.reply(messagePayload.text, messagePayload.options);
    }
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

bot.command('master', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    SecurityManager.validateMasterAccess(ctx);
    
    const [pendingFacilities, pendingRequests, totalFacilities, activeFacilities, totalUsers] = await Promise.all([
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.facilityMember.count({ where: { status: 'pending' } }),
      prisma.facility.count(),
      prisma.facility.count({ where: { status: 'active' } }),
      prisma.user.count()
    ]);
    
    await ctx.reply(
      `👑 **Master Admin Control Panel**\n\n` +
      `📊 **System Statistics:**\n` +
      `• Total Facilities: ${totalFacilities}\n` +
      `• Active Facilities: ${activeFacilities}\n` +
      `• Pending Facilities: ${pendingFacilities}\n` +
      `• Total Users: ${totalUsers}\n` +
      `• Pending Requests: ${pendingRequests}\n\n` +
      `🎛️ **Master Controls:**`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('🏢 Manage Facilities', 'master_facilities'),
              Markup.button.callback('👥 Manage Users', 'master_users')
            ],
            [
              Markup.button.callback('📊 System Reports', 'master_reports'),
              Markup.button.callback('⚙️ System Settings', 'master_settings')
            ],
            [
              Markup.button.callback('🔍 Quick Actions', 'master_quick'),
              Markup.button.callback('📋 Pending Items', 'master_pending')
            ],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'master_command');
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

// === Master Custom Commands ===
bot.command('stats', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    SecurityManager.validateMasterAccess(ctx);
    
    const [totalFacilities, activeFacilities, pendingFacilities, totalUsers, totalWorkOrders] = await Promise.all([
      prisma.facility.count(),
      prisma.facility.count({ where: { status: 'active' } }),
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.user.count(),
      prisma.workOrder.count()
    ]);
    
    await ctx.reply(
      `📊 **System Statistics**\n\n` +
      `🏢 **Facilities:**\n` +
      `• Total: ${totalFacilities}\n` +
      `• Active: ${activeFacilities}\n` +
      `• Pending: ${pendingFacilities}\n\n` +
      `👥 **Users:** ${totalUsers}\n` +
      `📋 **Work Orders:** ${totalWorkOrders}\n\n` +
      `🕐 **Last Updated:** ${new Date().toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  }, ctx, 'stats_command');
});

bot.command('approveall', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    SecurityManager.validateMasterAccess(ctx);
    
    const pendingFacilities = await prisma.facility.findMany({
      where: { status: 'pending' },
      include: {
        members: {
          where: { role: 'facility_admin' },
          include: { user: true }
        }
      }
    });
    
    if (pendingFacilities.length === 0) {
      return ctx.reply('✅ No pending facilities to approve.');
    }
    
    let approvedCount = 0;
    for (const facility of pendingFacilities) {
      await prisma.facility.update({
        where: { id: facility.id },
        data: { status: 'active' }
      });
      
      // Notify facility admin
      const admin = facility.members[0]?.user;
      if (admin) {
        try {
          await bot.telegram.sendMessage(
            admin.tgId,
            `🎉 **Facility Approved!**\n\n` +
            `Your facility **${facility.name}** has been approved and is now active!\n\n` +
            `You can now start using all features of FixFlow.`,
            { parse_mode: 'Markdown' }
          );
        } catch (notifyError) {
          console.error('Failed to notify facility admin:', notifyError);
        }
      }
      
      approvedCount++;
    }
    
    await ctx.reply(
      `✅ **Bulk Approval Complete!**\n\n` +
      `Approved ${approvedCount} facilities successfully.\n\n` +
      `All facility admins have been notified.`,
      { parse_mode: 'Markdown' }
    );
  }, ctx, 'approveall_command');
});

bot.command('broadcast', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    SecurityManager.validateMasterAccess(ctx);
    
    const message = ctx.message.text.replace('/broadcast', '').trim();
    
    if (!message) {
      return ctx.reply(
        '📢 **Broadcast Message**\n\n' +
        'Usage: `/broadcast Your message here`\n\n' +
        'This will send the message to all users in the system.',
        { parse_mode: 'Markdown' }
      );
    }
    
    const users = await prisma.user.findMany({
      select: { tgId: true, firstName: true }
    });
    
    let sentCount = 0;
    let failedCount = 0;
    
    for (const user of users) {
      try {
        await bot.telegram.sendMessage(
          user.tgId,
          `📢 **System Broadcast**\n\n${message}`,
          { parse_mode: 'Markdown' }
        );
        sentCount++;
      } catch (error) {
        console.error(`Failed to send broadcast to user ${user.tgId}:`, error);
        failedCount++;
      }
    }
    
    await ctx.reply(
      `📢 **Broadcast Complete!**\n\n` +
      `✅ Sent: ${sentCount}\n` +
      `❌ Failed: ${failedCount}\n` +
      `👥 Total Users: ${users.length}`,
      { parse_mode: 'Markdown' }
    );
  }, ctx, 'broadcast_command');
});

bot.command('health', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    SecurityManager.validateMasterAccess(ctx);
    
    try {
      // Test database connection
      await prisma.$queryRaw`SELECT 1`;
      
      const [facilityCount, userCount] = await Promise.all([
        prisma.facility.count(),
        prisma.user.count()
      ]);
      
      await ctx.reply(
        `🏥 **System Health Check**\n\n` +
        `✅ Database: Connected\n` +
        `✅ Bot: Running\n` +
        `📊 Facilities: ${facilityCount}\n` +
        `👥 Users: ${userCount}\n` +
        `🕐 Check Time: ${new Date().toLocaleString()}\n\n` +
        `🟢 **System Status: HEALTHY**`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      await ctx.reply(
        `🏥 **System Health Check**\n\n` +
        `❌ Database: Connection Failed\n` +
        `❌ Error: ${error.message}\n` +
        `🕐 Check Time: ${new Date().toLocaleString()}\n\n` +
        `🔴 **System Status: UNHEALTHY**`,
        { parse_mode: 'Markdown' }
      );
    }
  }, ctx, 'health_command');
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

// === Work Order Flow Action Handlers ===

/**
 * Handle work type selection (Step 1 → Step 2)
 * Pattern: wo_type|maintenance, wo_type|repair, etc.
 */
bot.action(/wo_type\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const workType = ctx.match[1];
    console.log(`Work type selected: ${workType} by user ${ctx.from.id}`);
    
    // Get current flow state
    const flowState = await FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'wo_new') {
      console.error(`Invalid flow state for user ${ctx.from.id}:`, flowState);
      return ctx.reply('⚠️ Invalid flow state. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      console.error(`Flow ownership validation failed for user ${ctx.from.id}`);
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    console.log(`Updating flow data for user ${ctx.from.id} with typeOfWork: ${workType}`);
    await FlowManager.updateData(ctx.from.id.toString(), { typeOfWork: workType });
    await FlowManager.updateStep(ctx.from.id.toString(), 2);
    
    // Step 2: Choose service type
    const serviceTypeButtons = [
      [Markup.button.callback('🔍 Preventive', 'wo_service|preventive')],
      [Markup.button.callback('🚨 Corrective', 'wo_service|corrective')],
      [Markup.button.callback('⚡ Emergency', 'wo_service|emergency')],
      [Markup.button.callback('🔧 Routine', 'wo_service|routine')],
      [Markup.button.callback('📋 Inspection', 'wo_service|inspection')],
      [Markup.button.callback('❌ Cancel', 'wo_cancel')]
    ];
    
    await ctx.editMessageText(
      `🔧 **Work Order Creation (2/6)**\n\n` +
      `✅ **Type:** ${workType}\n\n` +
      `🛠️ **Choose service type:**`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: serviceTypeButtons }
      }
    );
  }, ctx, 'wo_type_handler');
});

/**
 * Handle service type selection (Step 2 → Step 3)
 * Pattern: wo_service|preventive, wo_service|corrective, etc.
 */
bot.action(/wo_service\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const serviceType = ctx.match[1];
    console.log(`Service type selected: ${serviceType} by user ${ctx.from.id}`);
    
    // Get current flow state
    const flowState = await FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'wo_new' || flowState.step !== 2) {
      console.error(`Invalid flow state for user ${ctx.from.id}:`, flowState);
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Invalid flow state. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      console.error(`Flow ownership validation failed for user ${ctx.from.id}`);
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    console.log(`Updating flow data for user ${ctx.from.id} with typeOfService: ${serviceType}`);
    await FlowManager.updateData(ctx.from.id.toString(), { typeOfService: serviceType });
    await FlowManager.updateStep(ctx.from.id.toString(), 3);
    
    // Step 3: Choose priority
    const priorityButtons = [
      [Markup.button.callback('🔴 High Priority', 'wo_priority|high')],
      [Markup.button.callback('🟡 Medium Priority', 'wo_priority|medium')],
      [Markup.button.callback('🟢 Low Priority', 'wo_priority|low')],
      [Markup.button.callback('⚡ Critical', 'wo_priority|critical')],
      [Markup.button.callback('❌ Cancel', 'wo_cancel')]
    ];
    
    const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
    await ctx.editMessageText(
      `🔧 **Work Order Creation (3/6)**\n\n` +
      `✅ **Type:** ${updatedFlow.data.typeOfWork}\n` +
      `✅ **Service:** ${serviceType}\n\n` +
      `⚡ **Choose priority level:**`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: priorityButtons }
      }
    );
  }, ctx, 'wo_service_handler');
});

/**
 * Handle priority selection (Step 3 → Step 4)
 * Pattern: wo_priority|high, wo_priority|medium, etc.
 */
bot.action(/wo_priority\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const priority = ctx.match[1];
    console.log(`Priority selected: ${priority} by user ${ctx.from.id}`);
    
    // Get current flow state
    const flowState = await FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'wo_new' || flowState.step !== 3) {
      console.error(`Invalid flow state for user ${ctx.from.id}:`, flowState);
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Invalid flow state. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      console.error(`Flow ownership validation failed for user ${ctx.from.id}`);
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    console.log(`Updating flow data for user ${ctx.from.id} with priority: ${priority}`);
    await FlowManager.updateData(ctx.from.id.toString(), { priority });
    await FlowManager.updateStep(ctx.from.id.toString(), 4);
    
    const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
    await ctx.editMessageText(
      `🔧 **Work Order Creation (4/6)**\n\n` +
      `✅ **Type:** ${updatedFlow.data.typeOfWork}\n` +
      `✅ **Service:** ${updatedFlow.data.typeOfService}\n` +
      `✅ **Priority:** ${priority}\n\n` +
      `📍 **Please enter the location where the work is needed**\n` +
      `(e.g., "Building A, Room 101", "Parking Lot", "Main Entrance")\n\n` +
      `Type your response below or type /cancel to exit:`,
      {
        parse_mode: 'Markdown'
      }
    );
  }, ctx, 'wo_priority_handler');
});

/**
 * Handle work order confirmation
 */
bot.action('wo_confirm', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`Work order confirmation by user ${ctx.from.id}`);
    
    // Get current flow state
    const flowState = await FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'wo_new') {
      console.error(`Invalid flow state for user ${ctx.from.id}:`, flowState);
      return ctx.reply('⚠️ Invalid flow state. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      console.error(`Flow ownership validation failed for user ${ctx.from.id}`);
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    try {
      const { user } = await requireActiveMembership(ctx);
      const data = flowState.data;
      
      // Create work order in database
      const workOrder = await prisma.workOrder.create({
        data: {
          facilityId: user.activeFacilityId,
          createdByUserId: user.id,
          typeOfWork: data.typeOfWork,
          typeOfService: data.typeOfService,
          priority: data.priority,
          location: data.location,
          equipment: data.equipment,
          description: data.description,
          status: 'open'
        }
      });
      
      // Clear flow state
      await FlowManager.clearFlow(ctx.from.id.toString());
      
      await ctx.editMessageText(
        `✅ **Work Order Created Successfully!**\n\n` +
        `🆔 **Order ID:** #${workOrder.id.toString()}\n` +
        `📋 **Type:** ${data.typeOfWork}\n` +
        `🛠️ **Service:** ${data.typeOfService}\n` +
        `⚡ **Priority:** ${data.priority}\n` +
        `📍 **Location:** ${data.location}\n` +
        `🔧 **Equipment:** ${data.equipment || 'Not specified'}\n` +
        `📝 **Description:** ${data.description}\n\n` +
        `📅 **Created:** ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}\n` +
        `🔵 **Status:** Open\n\n` +
        `Your work order has been submitted and assigned to the appropriate team.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('📋 View My Orders', 'wo_list')],
              [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
            ]
          }
        }
      );
      
      console.log(`Work order created successfully: #${workOrder.id.toString()} for user ${ctx.from.id}`);
    } catch (error) {
      console.error('Error creating work order:', error);
      await FlowManager.clearFlow(ctx.from.id.toString());
      
      if (error.message === 'no_active_facility') {
        await ctx.editMessageText(
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
        await ctx.editMessageText(
          '⚠️ **Error Creating Work Order**\n\n' +
          'An error occurred while creating your work order. Please try again later.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]]
            }
          }
        );
      }
    }
  }, ctx, 'wo_confirm_handler');
});

/**
 * Handle work order cancellation
 */
bot.action('wo_cancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`Work order cancelled by user ${ctx.from.id}`);
    
    // Clear flow state
    await FlowManager.clearFlow(ctx.from.id.toString());
    
    await ctx.editMessageText(
      '❌ **Work Order Cancelled**\n\n' +
      'Your work order creation has been cancelled. No changes were made.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('➕ New Work Order', 'wo_new')],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'wo_cancel_handler');
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

/**
 * إنشاء إشعار جديد
 * @param {BigInt} userId - معرف المستخدم
 * @param {BigInt} facilityId - معرف المنشأة
 * @param {string} type - نوع الإشعار
 * @param {string} title - عنوان الإشعار
 * @param {string} message - نص الإشعار
 * @param {Object} data - بيانات إضافية
 */
async function createNotification(userId, facilityId, type, title, message, data = null) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        facilityId,
        type,
        title,
        message,
        data,
        isRead: false
      }
    });
    
    console.log(`Notification created: ${notification.id} for user ${userId}`);
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
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

// === Facility Registration Plan Selection Handler ===
bot.action(/regfac_plan\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const planType = ctx.match[1];
    console.log(`Plan selected: ${planType} by user ${ctx.from.id}`);
    
    // Get current flow state
    const flowState = await FlowManager.getFlow(ctx.from.id.toString());
    if (!flowState || flowState.flow !== 'reg_fac' || flowState.step !== 4) {
      console.error(`Invalid flow state for user ${ctx.from.id}:`, flowState);
      
      // If flow is null or invalid, redirect to start registration
      if (!flowState) {
        return ctx.reply(
          '⚠️ **Registration Session Expired**\n\n' +
          'Your registration session has expired. Please start over.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback('🏢 Start Registration', 'reg_fac_start')],
                [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
              ]
            }
          }
        );
      }
      
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Invalid registration flow. Please start over.');
    }
    
    // Validate flow ownership
    if (!FlowManager.validateFlowOwnership(ctx.from.id.toString(), flowState)) {
      console.error(`Flow ownership validation failed for user ${ctx.from.id}`);
      await FlowManager.clearFlow(ctx.from.id.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    try {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      // Update flow data with plan
      await FlowManager.updateData(ctx.from.id.toString(), { plan: planType });
      const updatedFlow = await FlowManager.getFlow(ctx.from.id.toString());
      const data = updatedFlow.data;
      
      // Create facility in database
      const facility = await prisma.$transaction(async (tx) => {
        const f = await tx.facility.create({
          data: {
            name: data.name,
            city: data.city,
            phone: data.phone,
            isDefault: false,
            planTier: planType.charAt(0).toUpperCase() + planType.slice(1).toLowerCase(),
            status: 'pending'
          }
        });
        
        await tx.facilityMember.create({
          data: { 
            userId: user.id, 
            facilityId: f.id, 
            role: 'facility_admin',
            status: 'active'
          }
        });
        
        await tx.user.update({
          where: { id: user.id },
          data: {
            activeFacilityId: f.id
          }
        });
        
        return f;
      });
      
      // Clear flow state
      await FlowManager.clearFlow(ctx.from.id.toString());
      
      await ctx.editMessageText(
        `✅ **Facility Registration Submitted!**\n\n` +
        `🏢 **Name:** ${facility.name}\n` +
        `🏙️ **City:** ${data.city}\n` +
        `📞 **Phone:** ${data.phone}\n` +
        `💼 **Plan:** ${planType}\n` +
        `📅 **Status:** Pending (awaiting activation)\n\n` +
        `Your facility registration has been submitted for review. You will receive a notification once it's approved.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
            ]
          }
        }
      );
      
      // Notify master if configured
      if (process.env.MASTER_ID) {
        try {
          await bot.telegram.sendMessage(
            process.env.MASTER_ID,
            `🆕 **New Facility Registration**\n\n` +
            `👤 **User:** ${ctx.from.id} (@${ctx.from.username || 'unknown'})\n` +
            `🏢 **Facility:** ${facility.name}\n` +
            `🏙️ **City:** ${data.city}\n` +
            `📞 **Phone:** ${data.phone}\n` +
            `💼 **Plan:** ${planType}\n` +
            `🆔 **Facility ID:** #${facility.id.toString()}`,
            { parse_mode: 'Markdown' }
          );
        } catch (notifyError) {
          console.error('Failed to notify master:', notifyError);
        }
      }
      
      console.log(`Facility registered successfully: #${facility.id.toString()} for user ${ctx.from.id}`);
    } catch (error) {
      console.error('Error creating facility:', error);
      
      // Don't clear flow immediately - let user retry
      await ctx.editMessageText(
        '⚠️ **Registration Error**\n\n' +
        'An error occurred while registering your facility.\n\n' +
        '**Error:** ' + error.message + '\n\n' +
        'Please try again or contact support.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🔄 Try Again', 'regfac_plan|' + planType)],
              [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
            ]
          }
        }
      );
    }
  }, ctx, 'regfac_plan_handler');
});

// === Facility Registration Cancel Handler ===
bot.action('regfac_cancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`Facility registration cancelled by user ${ctx.from.id}`);
    
    // Clear flow state
    await FlowManager.clearFlow(ctx.from.id.toString());
    
    await ctx.editMessageText(
      '❌ **Facility Registration Cancelled**\n\n' +
      'Your facility registration has been cancelled. No changes were made.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏢 Register Facility', 'reg_fac_start')],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'regfac_cancel_handler');
});

// === User Registration Cancel Handler ===
bot.action('user_reg_cancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`User registration cancelled by user ${ctx.from.id}`);
    
    // Clear flow state
    await FlowManager.clearFlow(ctx.from.id.toString());
    
    await ctx.editMessageText(
      '❌ **User Registration Cancelled**\n\n' +
      'Your registration has been cancelled. No changes were made.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔗 Join Facility', 'join_fac_start')],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'user_reg_cancel_handler');
});

// === Back to Menu Handler ===
bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`Back to menu requested by user ${ctx.from.id}`);
    
    // Clear any active flow state
    await FlowManager.clearFlow(ctx.from.id.toString());
    
    await showMainMenu(ctx);
  }, ctx, 'back_to_menu_handler');
});

// === Help Handler ===
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`Help requested by user ${ctx.from.id}`);
    
    const helpText = 
      `❓ **FixFlow Bot Help**\n\n` +
      `🔧 **What is FixFlow?**\n` +
      `FixFlow is a comprehensive maintenance management system that helps facilities manage work orders, track issues, and coordinate maintenance tasks.\n\n` +
      `🏢 **Facility Management:**\n` +
      `• Register a new facility\n` +
      `• Join an existing facility\n` +
      `• Switch between facilities\n` +
      `• Manage facility members\n\n` +
      `📋 **Work Orders:**\n` +
      `• Create new work orders\n` +
      `• Track existing orders\n` +
      `• View order status\n` +
      `• Receive notifications\n\n` +
      `👥 **User Roles:**\n` +
      `• **User:** Submit work orders\n` +
      `• **Technician:** Manage assigned orders\n` +
      `• **Supervisor:** Oversee operations\n` +
      `• **Admin:** Full facility management\n\n` +
      `📞 **Support:**\n` +
      `Contact your facility administrator for assistance with specific issues.`;
    
    await ctx.editMessageText(helpText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
        ]
      }
    });
  }, ctx, 'help_handler');
});

// === Admin and Master Panel Handlers ===

/**
 * Admin Panel Handler
 */
bot.action('admin_panel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`Admin panel requested by user ${ctx.from.id}`);
    
    await ctx.editMessageText(
      '👑 **Admin Panel**\n\n' +
      'Administrative features are currently under development.\n\n' +
      'Available admin functions will include:\n' +
      '• User management\n' +
      '• Facility settings\n' +
      '• Work order oversight\n' +
      '• Reports and analytics',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'admin_panel_handler');
});

/**
 * Master List Facilities Handler
 */
bot.action('master_list_fac', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`Master list facilities requested by user ${ctx.from.id}`);
    
    // Get pending facilities
    const pendingFacilities = await prisma.facility.findMany({
      where: { status: 'pending' },
      include: {
        members: {
          where: { role: 'facility_admin' },
          include: { user: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    if (pendingFacilities.length === 0) {
      return ctx.editMessageText(
        '🏢 **Facility Management**\n\n' +
        '✅ No pending facilities to review.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
            ]
          }
        }
      );
    }
    
    let facilitiesText = '🏢 **Pending Facilities for Review**\n\n';
    const buttons = [];
    
    pendingFacilities.forEach((facility, index) => {
      const admin = facility.members[0]?.user;
      facilitiesText += `${index + 1}. **${facility.name}**\n`;
      facilitiesText += `   📍 City: ${facility.city || 'Not specified'}\n`;
      facilitiesText += `   📞 Phone: ${facility.phone || 'Not specified'}\n`;
      facilitiesText += `   💼 Plan: ${facility.planTier}\n`;
      facilitiesText += `   👤 Admin: ${admin ? `${admin.firstName} ${admin.lastName || ''}` : 'Unknown'}\n`;
      facilitiesText += `   📅 Created: ${facility.createdAt.toLocaleDateString()}\n\n`;
      
      buttons.push([
        Markup.button.callback(`✅ Approve ${facility.name}`, `approve_fac|${facility.id}`),
        Markup.button.callback(`❌ Reject ${facility.name}`, `reject_fac|${facility.id}`)
      ]);
    });
    
    buttons.push([Markup.button.callback('🏠 Main Menu', 'back_to_menu')]);
    
    await ctx.editMessageText(facilitiesText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'master_list_fac_handler');
});

/**
 * Master List Members Handler  
 */
bot.action('master_list_members', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    console.log(`Master list members requested by user ${ctx.from.id}`);
    
    await ctx.editMessageText(
      '👥 **Member Management**\n\n' +
      'Master member management features are currently under development.\n\n' +
      'This will include:\n' +
      '• Review pending member requests\n' +
      '• Approve/reject memberships\n' +
      '• Member oversight',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'master_list_members_handler');
});

// === Facility Approval Handlers ===
bot.action(/approve_fac\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const facilityId = BigInt(ctx.match[1]);
    console.log(`Approving facility ${facilityId} by user ${ctx.from.id}`);
    
    // Update facility status to active
    const facility = await prisma.facility.update({
      where: { id: facilityId },
      data: { status: 'active' },
      include: {
        members: {
          where: { role: 'facility_admin' },
          include: { user: true }
        }
      }
    });
    
    const admin = facility.members[0]?.user;
    
    await ctx.editMessageText(
      `✅ **Facility Approved Successfully!**\n\n` +
      `🏢 **Name:** ${facility.name}\n` +
      `📍 **City:** ${facility.city}\n` +
      `📞 **Phone:** ${facility.phone}\n` +
      `💼 **Plan:** ${facility.planTier}\n` +
      `👤 **Admin:** ${admin ? `${admin.firstName} ${admin.lastName || ''}` : 'Unknown'}\n\n` +
      `The facility is now active and ready to use!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏢 Review More Facilities', 'master_list_fac')],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
    
    // Notify facility admin
    if (admin) {
      try {
        await bot.telegram.sendMessage(
          admin.tgId,
          `🎉 **Facility Approved!**\n\n` +
          `Your facility **${facility.name}** has been approved and is now active!\n\n` +
          `You can now start using all features of FixFlow.`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyError) {
        console.error('Failed to notify facility admin:', notifyError);
      }
    }
    
  }, ctx, 'approve_facility_handler');
});

bot.action(/reject_fac\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const facilityId = BigInt(ctx.match[1]);
    console.log(`Rejecting facility ${facilityId} by user ${ctx.from.id}`);
    
    // Get facility info before deletion
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId },
      include: {
        members: {
          where: { role: 'facility_admin' },
          include: { user: true }
        }
      }
    });
    
    if (!facility) {
      return ctx.reply('❌ Facility not found.');
    }
    
    const admin = facility.members[0]?.user;
    
    // Delete facility and related data
    await prisma.$transaction(async (tx) => {
      // Delete facility members
      await tx.facilityMember.deleteMany({
        where: { facilityId }
      });
      
      // Delete facility
      await tx.facility.delete({
        where: { id: facilityId }
      });
    });
    
    await ctx.editMessageText(
      `❌ **Facility Rejected**\n\n` +
      `🏢 **Name:** ${facility.name}\n` +
      `📍 **City:** ${facility.city}\n` +
      `👤 **Admin:** ${admin ? `${admin.firstName} ${admin.lastName || ''}` : 'Unknown'}\n\n` +
      `The facility registration has been rejected and removed from the system.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🏢 Review More Facilities', 'master_list_fac')],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
    
    // Notify facility admin
    if (admin) {
      try {
        await bot.telegram.sendMessage(
          admin.tgId,
          `❌ **Facility Registration Rejected**\n\n` +
          `Unfortunately, your facility registration for **${facility.name}** has been rejected.\n\n` +
          `Please contact support if you have any questions.`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyError) {
        console.error('Failed to notify facility admin:', notifyError);
      }
    }
    
  }, ctx, 'reject_facility_handler');
});

// === Master Panel Handlers ===
bot.action('master_facilities', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const facilities = await prisma.facility.findMany({
      include: {
        members: {
          where: { role: 'facility_admin' },
          include: { user: true }
        },
        _count: {
          select: { members: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    let facilitiesText = '🏢 **All Facilities Management**\n\n';
    const buttons = [];
    
    facilities.forEach((facility, index) => {
      const admin = facility.members[0]?.user;
      const statusEmoji = facility.status === 'active' ? '✅' : '⏳';
      const statusText = facility.status === 'active' ? 'Active' : 'Pending';
      
      facilitiesText += `${index + 1}. ${statusEmoji} **${facility.name}**\n`;
      facilitiesText += `   📍 ${facility.city || 'No city'}\n`;
      facilitiesText += `   👥 Members: ${facility._count.members}\n`;
      facilitiesText += `   👤 Admin: ${admin ? `${admin.firstName} ${admin.lastName || ''}` : 'Unknown'}\n`;
      facilitiesText += `   📅 Created: ${facility.createdAt.toLocaleDateString()}\n\n`;
      
      if (facility.status === 'pending') {
        buttons.push([
          Markup.button.callback(`✅ Approve ${facility.name}`, `approve_fac|${facility.id}`),
          Markup.button.callback(`❌ Reject ${facility.name}`, `reject_fac|${facility.id}`)
        ]);
      } else {
        buttons.push([
          Markup.button.callback(`🔧 Manage ${facility.name}`, `manage_fac|${facility.id}`),
          Markup.button.callback(`📊 Stats ${facility.name}`, `stats_fac|${facility.id}`)
        ]);
      }
    });
    
    buttons.push([
      Markup.button.callback('🔙 Back to Master Panel', 'master_panel'),
      Markup.button.callback('🏠 Main Menu', 'back_to_menu')
    ]);
    
    await ctx.editMessageText(facilitiesText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'master_facilities_handler');
});

bot.action('master_users', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const users = await prisma.user.findMany({
      include: {
        facilityMemberships: {
          include: { facility: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 20 // Show last 20 users
    });
    
    let usersText = '👥 **User Management**\n\n';
    const buttons = [];
    
    users.forEach((user, index) => {
      const facilityCount = user.facilityMemberships.length;
      const activeFacilities = user.facilityMemberships.filter(fm => fm.facility.status === 'active').length;
      
      usersText += `${index + 1}. **${user.firstName} ${user.lastName || ''}**\n`;
      usersText += `   🆔 ID: ${user.tgId}\n`;
      usersText += `   🏢 Facilities: ${activeFacilities}/${facilityCount}\n`;
      usersText += `   📅 Joined: ${user.createdAt.toLocaleDateString()}\n\n`;
      
      buttons.push([
        Markup.button.callback(`👤 View ${user.firstName}`, `view_user|${user.id}`),
        Markup.button.callback(`🔧 Manage ${user.firstName}`, `manage_user|${user.id}`)
      ]);
    });
    
    buttons.push([
      Markup.button.callback('🔙 Back to Master Panel', 'master_panel'),
      Markup.button.callback('🏠 Main Menu', 'back_to_menu')
    ]);
    
    await ctx.editMessageText(usersText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'master_users_handler');
});

bot.action('master_reports', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const [totalFacilities, activeFacilities, pendingFacilities, totalUsers, totalWorkOrders] = await Promise.all([
      prisma.facility.count(),
      prisma.facility.count({ where: { status: 'active' } }),
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.user.count(),
      prisma.workOrder.count()
    ]);
    
    const recentFacilities = await prisma.facility.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    
    let reportsText = '📊 **System Reports**\n\n';
    reportsText += `📈 **Overview:**\n`;
    reportsText += `• Total Facilities: ${totalFacilities}\n`;
    reportsText += `• Active Facilities: ${activeFacilities}\n`;
    reportsText += `• Pending Facilities: ${pendingFacilities}\n`;
    reportsText += `• Total Users: ${totalUsers}\n`;
    reportsText += `• Total Work Orders: ${totalWorkOrders}\n\n`;
    
    if (recentFacilities.length > 0) {
      reportsText += `🆕 **Recent Facilities (Last 7 days):**\n`;
      recentFacilities.forEach((facility, index) => {
        reportsText += `${index + 1}. ${facility.name} - ${facility.status}\n`;
      });
    }
    
    const buttons = [
      [Markup.button.callback('📈 Detailed Analytics', 'detailed_analytics')],
      [Markup.button.callback('📋 Export Data', 'export_data')],
      [
        Markup.button.callback('🔙 Back to Master Panel', 'master_panel'),
        Markup.button.callback('🏠 Main Menu', 'back_to_menu')
      ]
    ];
    
    await ctx.editMessageText(reportsText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'master_reports_handler');
});

bot.action('master_settings', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    await ctx.editMessageText(
      '⚙️ **System Settings**\n\n' +
      '🔧 **Available Settings:**\n' +
      '• Bot Configuration\n' +
      '• Database Management\n' +
      '• Security Settings\n' +
      '• Notification Settings\n\n' +
      '⚠️ Advanced settings require direct database access.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔧 Bot Config', 'bot_config')],
            [Markup.button.callback('🗄️ Database Tools', 'db_tools')],
            [
              Markup.button.callback('🔙 Back to Master Panel', 'master_panel'),
              Markup.button.callback('🏠 Main Menu', 'back_to_menu')
            ]
          ]
        }
      }
    );
  }, ctx, 'master_settings_handler');
});

bot.action('master_quick', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    await ctx.editMessageText(
      '🔍 **Quick Actions**\n\n' +
      '⚡ **Common Tasks:**\n' +
      '• Approve all pending facilities\n' +
      '• System health check\n' +
      '• Send broadcast message\n' +
      '• Emergency actions\n\n' +
      'Select an action:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('✅ Approve All Facilities', 'approve_all_facilities')],
            [Markup.button.callback('🏥 System Health Check', 'system_health')],
            [Markup.button.callback('📢 Broadcast Message', 'broadcast_message')],
            [
              Markup.button.callback('🔙 Back to Master Panel', 'master_panel'),
              Markup.button.callback('🏠 Main Menu', 'back_to_menu')
            ]
          ]
        }
      }
    );
  }, ctx, 'master_quick_handler');
});

bot.action('master_pending', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const [pendingFacilities, pendingRequests] = await Promise.all([
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.facilityMember.count({ where: { status: 'pending' } })
    ]);
    
    let pendingText = '📋 **Pending Items Dashboard**\n\n';
    
    if (pendingFacilities > 0) {
      pendingText += `🏢 **Pending Facilities:** ${pendingFacilities}\n`;
    }
    
    if (pendingRequests > 0) {
      pendingText += `👥 **Pending Join Requests:** ${pendingRequests}\n`;
    }
    
    if (pendingFacilities === 0 && pendingRequests === 0) {
      pendingText += '🎉 No pending items!';
    }
    
    const buttons = [];
    
    if (pendingFacilities > 0) {
      buttons.push([Markup.button.callback('🏢 Review Facilities', 'master_list_fac')]);
    }
    
    if (pendingRequests > 0) {
      buttons.push([Markup.button.callback('👥 Review Requests', 'master_list_members')]);
    }
    
    buttons.push([
      Markup.button.callback('🔙 Back to Master Panel', 'master_panel'),
      Markup.button.callback('🏠 Main Menu', 'back_to_menu')
    ]);
    
    await ctx.editMessageText(pendingText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }, ctx, 'master_pending_handler');
});

// Back to master panel handler
bot.action('master_panel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  return ErrorHandler.safeExecute(async () => {
    const [pendingFacilities, pendingRequests, totalFacilities, activeFacilities, totalUsers] = await Promise.all([
      prisma.facility.count({ where: { status: 'pending' } }),
      prisma.facilityMember.count({ where: { status: 'pending' } }),
      prisma.facility.count(),
      prisma.facility.count({ where: { status: 'active' } }),
      prisma.user.count()
    ]);
    
    await ctx.editMessageText(
      `👑 **Master Admin Control Panel**\n\n` +
      `📊 **System Statistics:**\n` +
      `• Total Facilities: ${totalFacilities}\n` +
      `• Active Facilities: ${activeFacilities}\n` +
      `• Pending Facilities: ${pendingFacilities}\n` +
      `• Total Users: ${totalUsers}\n` +
      `• Pending Requests: ${pendingRequests}\n\n` +
      `🎛️ **Master Controls:**`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('🏢 Manage Facilities', 'master_facilities'),
              Markup.button.callback('👥 Manage Users', 'master_users')
            ],
            [
              Markup.button.callback('📊 System Reports', 'master_reports'),
              Markup.button.callback('⚙️ System Settings', 'master_settings')
            ],
            [
              Markup.button.callback('🔍 Quick Actions', 'master_quick'),
              Markup.button.callback('📋 Pending Items', 'master_pending')
            ],
            [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
          ]
        }
      }
    );
  }, ctx, 'master_panel_handler');
});

// ===== تشغيل البوت =====
// تشغيل البوت في وضع polling للاختبار المحلي
if (process.env.NODE_ENV !== 'production') {
  console.log('🚀 Starting bot in polling mode...');
  bot.launch()
    .then(() => {
      console.log('✅ Bot started successfully in polling mode');
      console.log('📱 Bot is ready to receive messages');
    })
    .catch((error) => {
      console.error('❌ Failed to start bot:', error.message);
      process.exit(1);
    });

  // إيقاف البوت بشكل أنيق عند إغلاق العملية
  process.once('SIGINT', () => {
    console.log('🛑 Stopping bot...');
    bot.stop('SIGINT');
  });
  
  process.once('SIGTERM', () => {
    console.log('🛑 Stopping bot...');
    bot.stop('SIGTERM');
  });
} else {
  // في الإنتاج، البوت يعمل عبر webhook
  console.log('🌐 Bot configured for webhook mode');
}

// === Enhanced Work Order Flow Handlers ===
const EnhancedWorkOrderController = require('./controllers/enhancedWorkOrderController');

// بدء إنشاء طلب صيانة محسن
bot.action('wo_enhanced_start', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await EnhancedWorkOrderController.startEnhancedWorkOrderCreation(ctx);
});

// معالجة اختيار نوع العمل المحسن
bot.action(/wo_enhanced_type\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await EnhancedWorkOrderController.handleWorkTypeSelection(ctx, ctx.match[1]);
});

// معالجة اختيار نوع الخدمة المحسن
bot.action(/wo_enhanced_service\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await EnhancedWorkOrderController.handleServiceTypeSelection(ctx, ctx.match[1]);
});

// معالجة اختيار الأولوية المحسن
bot.action(/wo_enhanced_priority\|(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await EnhancedWorkOrderController.handlePrioritySelection(ctx, ctx.match[1]);
});

// تأكيد إنشاء طلب الصيانة المحسن
bot.action('wo_enhanced_confirm', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await EnhancedWorkOrderController.confirmWorkOrderCreation(ctx);
});

// العودة للخطوة السابقة
bot.action('wo_enhanced_back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await EnhancedWorkOrderController.goBack(ctx);
});

// إلغاء إنشاء طلب الصيانة
bot.action('wo_enhanced_cancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await EnhancedWorkOrderController.cancelWorkOrderCreation(ctx);
});

// تخطي إدخال المعدات
bot.action('wo_enhanced_skip', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await EnhancedWorkOrderController.handleEquipmentInput(ctx, '');
});

// معالجة النصوص للتدفق المحسن
bot.on('text', async (ctx, next) => {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    const text = ctx.message.text;
    
    // التحقق من التدفق المحسن
    const flow = await require('./utils/smartFlowManager').getFlow(user.tgId.toString());
    if (flow && flow.flow === 'wo_enhanced') {
      
      // معالجة إدخال الموقع (الخطوة 4)
      if (flow.step === 4) {
        if (text.toLowerCase() === '/cancel') {
          await EnhancedWorkOrderController.cancelWorkOrderCreation(ctx);
          return;
        }
        await EnhancedWorkOrderController.handleLocationInput(ctx, text);
        return;
      }
      
      // معالجة إدخال المعدات (الخطوة 5)
      if (flow.step === 5) {
        if (text.toLowerCase() === '/cancel') {
          await EnhancedWorkOrderController.cancelWorkOrderCreation(ctx);
          return;
        }
        if (text.toLowerCase() === '/skip') {
          await EnhancedWorkOrderController.handleEquipmentInput(ctx, '');
          return;
        }
        await EnhancedWorkOrderController.handleEquipmentInput(ctx, text);
        return;
      }
      
      // معالجة إدخال الوصف (الخطوة 6)
      if (flow.step === 6) {
        if (text.toLowerCase() === '/cancel') {
          await EnhancedWorkOrderController.cancelWorkOrderCreation(ctx);
          return;
        }
        await EnhancedWorkOrderController.handleDescriptionInput(ctx, text);
        return;
      }
    }
    
    // إذا لم يكن هناك تدفق محسن، انتقل للمعالج التالي
    await next();
    
  } catch (error) {
    console.error('Error in enhanced text handler:', error);
    await next();
  }
});

// Export the bot for Vercel
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      console.log('📨 Received webhook update:', JSON.stringify(req.body, null, 2));
      await bot.handleUpdate(req.body, res);
    } else {
      res.status(200).send('Bot is running');
    }
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
};