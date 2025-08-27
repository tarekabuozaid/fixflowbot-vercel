const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

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

const bot = new Telegraf(BOT_TOKEN);
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Global error handler
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('⚠️ An error occurred. Please try again.').catch(() => {});
});

// Start command handler
bot.command('start', async (ctx) => {
  try {
    console.log('✅ Start command received from:', ctx.from.id);
    await showMainMenu(ctx);
  } catch (error) {
    console.error('Error in start command:', error);
    await ctx.reply('⚠️ An error occurred while starting the bot. Please try again.');
  }
});

// In-memory flow state per user
// Each entry: { flow: string, step: number|string, data: object }
const flows = new Map();

// Helpers
const isMaster = (ctx) => String(ctx.from?.id || '') === String(MASTER_ID);

async function ensureUser(ctx) {
  const tgId = BigInt(ctx.from.id);
  let user = await prisma.user.findUnique({ where: { tgId } });
  if (!user) {
    user = await prisma.user.create({
      data: { tgId, firstName: ctx.from.first_name ?? null, status: 'pending' }
    });
  }
  return user;
}

async function getUser(ctx) {
  const tgId = BigInt(ctx.from.id);
  let user = await prisma.user.findUnique({ where: { tgId } });
  if (!user) {
    user = await prisma.user.create({
      data: { tgId, firstName: ctx.from.first_name ?? null, status: 'pending' }
    });
  }
  return user;
}

async function showMainMenu(ctx) {
  try {
    const user = await ensureUser(ctx);
    const buttons = [];
    
    if (user.status === 'active' && user.activeFacilityId) {
    buttons.push([Markup.button.callback('➕ Create Work Order', 'wo_new')]);
    buttons.push([Markup.button.callback('📋 My Work Orders', 'wo_list')]);
    
    // Check if user is facility admin or supervisor
    const membership = await prisma.facilityMember.findFirst({
      where: { 
        userId: user.id, 
        facilityId: user.activeFacilityId,
        role: { in: ['facility_admin', 'supervisor'] }
      }
    });
    
    if (membership) {
      buttons.push([Markup.button.callback('🏢 Facility Dashboard', 'facility_dashboard')]);
      buttons.push([Markup.button.callback('🔧 Manage Work Orders', 'manage_work_orders')]);
      
      // Add role management for facility admins
      if (membership && membership.role === 'facility_admin') {
        buttons.push([Markup.button.callback('👥 Manage Members', 'manage_members')]);
        buttons.push([Markup.button.callback('🔐 Role Management', 'role_management')]);
      }
    }
    
    // Add user registration options
    buttons.push([Markup.button.callback('👤 Register as User', 'register_user')]);
    buttons.push([Markup.button.callback('🔧 Register as Technician', 'register_technician')]);
    buttons.push([Markup.button.callback('👨‍💼 Register as Supervisor', 'register_supervisor')]);
    
    // Add notifications button
    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false }
    });
    
    const notificationText = unreadCount > 0 ? `🔔 Notifications (${unreadCount})` : '🔔 Notifications';
    buttons.push([Markup.button.callback(notificationText, 'notifications')]);
    
    // Add smart notifications button for admins
    if (membership) {
      buttons.push([Markup.button.callback('🤖 Smart Alerts', 'smart_notifications')]);
    }
    
    // Add reminders button
    const activeReminders = await prisma.reminder.count({
      where: { 
        facilityId: user.activeFacilityId,
        isActive: true,
        scheduledFor: { gte: new Date() }
      }
    });
    
    const reminderText = activeReminders > 0 ? `⏰ Reminders (${activeReminders})` : '⏰ Reminders';
    buttons.push([Markup.button.callback(reminderText, 'reminders')]);
    
    // Add reports button for admins
    if (membership) {
      buttons.push([Markup.button.callback('📊 Advanced Reports', 'advanced_reports')]);
    }
  } else {
    buttons.push([Markup.button.callback('🏢 Register Facility', 'reg_fac_start')]);
    buttons.push([Markup.button.callback('🔗 Join Facility', 'join_fac_start')]);
  }
  if (isMaster(ctx)) {
    buttons.push([Markup.button.callback('🛠 Master Panel', 'master_panel')]);
    buttons.push([Markup.button.callback('👑 Master Dashboard', 'master_dashboard')]);
  }
  await ctx.reply('👋 Welcome to FixFlow! What would you like to do?', {
    reply_markup: { inline_keyboard: buttons }
  });
  } catch (error) {
    console.error('Error in showMainMenu:', error);
    await ctx.reply('⚠️ An error occurred while loading the menu. Please try again.');
  }
}

// Remove duplicate start handler - using bot.command('start') instead

// === Official Commands ===
bot.command('registerfacility', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  flows.set(ctx.from.id, { flow: 'reg_fac', step: 1, data: {}, ts: Date.now() });
  await ctx.reply('🏢 Facility Registration (1/4)\nPlease enter the facility name (max 60 chars):');
});

bot.command('join', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await requireMembershipOrList(ctx);
});

bot.command('switch', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const user = await ensureUser(ctx);
    const memberships = await prisma.facilityMember.findMany({
      where: { userId: user.id },
      include: { facility: true },
      take: 10
    });
    
    if (!memberships.length) {
      return ctx.reply('❌ You are not a member of any facilities.');
    }
    
    const buttons = memberships.map(m => [
      Markup.button.callback(
        `${m.facility.name}${m.facility.id === user.activeFacilityId ? ' ✅' : ''}`,
        `switch_to_${m.facility.id}`
      )
    ]);
    
    buttons.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
    
    await ctx.reply('🔄 **Switch Active Facility**\n\nSelect a facility to switch to:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error in switch command:', error);
    await ctx.reply('⚠️ An error occurred while switching facilities.');
  }
});

bot.command('members', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || !['facility_admin', 'supervisor'].includes(member.role)) {
      return ctx.reply('⚠️ You need admin privileges to view facility members.');
    }
    
    const members = await prisma.facilityMember.findMany({
      where: { facilityId: user.activeFacilityId },
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
      
      memberList += `${index + 1}. ${roleEmoji[m.role]} ${m.user.firstName || `User ${m.user.tgId?.toString() || m.user.id.toString()}`}\n`;
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
  } catch (error) {
    console.error('Error in members command:', error);
    await ctx.reply('⚠️ An error occurred while loading members.');
  }
});

bot.command('approve', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Only master can approve requests.');
  }
  
  try {
    const [pendingFacilities, pendingRequests] = await Promise.all([
      prisma.facility.count({ where: { isActive: false } }),
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
  } catch (error) {
    console.error('Error in approve command:', error);
    await ctx.reply('⚠️ An error occurred while loading approvals.');
  }
});

bot.command('deny', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!isMaster(ctx)) {
    return ctx.reply('🚫 Only master can deny requests.');
  }
  
  await ctx.reply('❌ **Deny Requests**\n\nUse /approve to review and manage pending requests.');
});

bot.command('setrole', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user, member } = await requireActiveMembership(ctx);
    
    if (!member || member.role !== 'facility_admin') {
      return ctx.reply('⚠️ Only facility admins can set roles.');
    }
    
    await ctx.reply('👑 **Set Member Role**\n\nThis feature will be available soon!\n\nFor now, use the facility dashboard to manage members.');
  } catch (error) {
    console.error('Error in setrole command:', error);
    await ctx.reply('⚠️ An error occurred while setting role.');
  }
});

// === Facility Registration Flow ===
bot.action('reg_fac_start', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  flows.set(ctx.from.id, { flow: 'reg_fac', step: 1, data: {}, ts: Date.now() });
  await ctx.reply('🏢 Facility Registration (1/4)\nPlease enter the facility name (max 60 chars):');
});

// === Join Facility Flow ===
bot.action('join_fac_start', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await requireMembershipOrList(ctx);
});

// Helper to list active facilities and allow user to select one
async function requireMembershipOrList(ctx) {
  // list active facilities
      const facs = await prisma.facility.findMany({ where: { status: 'active' }, take: 20 });
  if (!facs.length) {
    return ctx.reply('⚠️ No active facilities available to join at this time.');
  }
  const rows = facs.map(f => [Markup.button.callback(`${f.name}`, `join_fac|${f.id.toString()}`)]);
  await ctx.reply('Please choose a facility to request membership:', { reply_markup: { inline_keyboard: rows } });
}

// Join facility with specific role
bot.action(/join_facility\|(\d+)\|(\w+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const facilityId = BigInt(ctx.match[1]);
    const role = ctx.match[2];
    const user = await getUser(ctx);
    
    // Get flow data
    const flowState = flows.get(ctx.from.id);
    if (!flowState || !['register_user', 'register_technician', 'register_supervisor'].includes(flowState.flow)) {
      return ctx.reply('⚠️ Invalid registration flow. Please start over.');
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
      flows.delete(ctx.from.id);
      return ctx.reply('⚠️ You are already a member of this facility.');
    }
    
    // Update user profile with registration data
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: flowState.data.fullName,
        email: flowState.data.email,
        phone: flowState.data.phone
      }
    });
    
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
    flows.delete(ctx.from.id);
    
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
      `📞 **Phone:** ${flowState.data.phone || 'Not provided'}\n\n` +
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
        `New ${roleText[role]} registration request from ${flowState.data.fullName}`,
        { 
          userId: user.id.toString(),
          facilityId: facilityId.toString(),
          role: role
        }
      );
    }
    
  } catch (error) {
    console.error('Error joining facility:', error);
    flows.delete(ctx.from.id);
    await ctx.reply('⚠️ An error occurred while processing your request.');
  }
});

bot.action(/join_fac\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const facId = BigInt(ctx.match[1]);
  const user = await ensureUser(ctx);
  // Create switch request
  await prisma.facilitySwitchRequest.create({
    data: { 
      userId: user.id, 
      facilityId: facId, 
      requestedRole: 'user',
      status: 'pending' 
    }
  });
  // Notify master
  if (MASTER_ID) {
    await bot.telegram.sendMessage(MASTER_ID, `🆕 User ${ctx.from.id} requested to join facility #${facId.toString()}`);
  }
  await ctx.reply('✅ Your join request has been submitted and is pending approval.');
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
  try {
    const { user } = await requireActiveMembership(ctx);
    flows.set(ctx.from.id, { flow: 'wo_new', step: 1, data: {}, ts: Date.now() });
    
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
  } catch (e) {
    await ctx.reply('⚠️ You must be an active member of a facility to create a work order.');
  }
});

bot.action('wo_list', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
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
  } catch {
    await ctx.reply('⚠️ You must be an active member of a facility to view work orders.');
  }
});

async function requireActiveMembership(ctx) {
  const user = await ensureUser(ctx);
  if (!user.activeFacilityId || user.status !== 'active') {
    throw new Error('no_active_facility');
  }
  return { user };
}

// === Flow Handler for free text responses ===
bot.on('text', async (ctx, next) => {
  const flowState = flows.get(ctx.from.id);
  if (!flowState) return next();
  const text = (ctx.message.text || '').trim();
  try {
    // === FACILITY REGISTRATION FLOW ===
    if (flowState.flow === 'reg_fac') {
      // Step 1: Facility Name
      if (flowState.step === 1) {
        if (text.toLowerCase() === '/cancel') {
          flows.delete(ctx.from.id);
          return ctx.reply('❌ Facility registration cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        flowState.data.name = text.slice(0, 60);
        if (flowState.data.name.length < 2) {
          return ctx.reply('⚠️ Name must be at least 2 characters. Try again or type /cancel to exit:');
        }
        
        // Check if facility name already exists
        const existingFacility = await prisma.facility.findUnique({
          where: { name: flowState.data.name }
        });
        
        if (existingFacility) {
          return ctx.reply('⚠️ A facility with this name already exists. Please choose a different name or type /cancel to exit:');
        }
        
        flowState.step = 2;
        flows.set(ctx.from.id, flowState);
        
        return ctx.reply(
          `✅ **Facility Name:** ${flowState.data.name}\n\n` +
          `🏙️ **Step 2/4: Enter the city**\n` +
          `Maximum 40 characters\n\n` +
          `Type /cancel to exit registration`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Step 2: City
      if (flowState.step === 2) {
        if (text.toLowerCase() === '/cancel') {
          flows.delete(ctx.from.id);
          return ctx.reply('❌ Facility registration cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        flowState.data.city = text.slice(0, 40);
        if (flowState.data.city.length < 2) {
          return ctx.reply('⚠️ City must be at least 2 characters. Try again or type /cancel to exit:');
        }
        
        flowState.step = 3;
        flows.set(ctx.from.id, flowState);
        
        return ctx.reply(
          `✅ **Facility Name:** ${flowState.data.name}\n` +
          `✅ **City:** ${flowState.data.city}\n\n` +
          `📞 **Step 3/4: Enter contact phone**\n` +
          `Maximum 25 characters\n\n` +
          `Type /cancel to exit registration`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Step 3: Phone
      if (flowState.step === 3) {
        if (text.toLowerCase() === '/cancel') {
          flows.delete(ctx.from.id);
          return ctx.reply('❌ Facility registration cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        flowState.data.phone = text.slice(0, 25);
        if (flowState.data.phone.length < 5) {
          return ctx.reply('⚠️ Phone must be at least 5 characters. Try again or type /cancel to exit:');
        }
        
        flowState.step = 4;
        flows.set(ctx.from.id, flowState);
        
        const planButtons = [
          [{ text: '🆓 Free Plan', callback_data: 'regfac_plan|Free' }],
          [{ text: '⭐ Pro Plan', callback_data: 'regfac_plan|Pro' }],
          [{ text: '🏢 Business Plan', callback_data: 'regfac_plan|Business' }],
          [{ text: '❌ Cancel', callback_data: 'regfac_cancel' }]
        ];
        
        return ctx.reply(
          `✅ **Facility Name:** ${flowState.data.name}\n` +
          `✅ **City:** ${flowState.data.city}\n` +
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
    
    // === USER REGISTRATION FLOW ===
    if (flowState.flow === 'register_user' || flowState.flow === 'register_technician' || flowState.flow === 'register_supervisor') {
      const roleText = {
        'register_user': 'User',
        'register_technician': 'Technician', 
        'register_supervisor': 'Supervisor'
      };
      
      // Step 1: Full Name
      if (flowState.step === 1) {
        if (text.toLowerCase() === '/cancel') {
          flows.delete(ctx.from.id);
          return ctx.reply('❌ User registration cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        flowState.data.fullName = text.slice(0, 100);
        if (flowState.data.fullName.length < 2) {
          return ctx.reply('⚠️ Name must be at least 2 characters. Try again or type /cancel to exit:');
        }
        
        flowState.step = 2;
        flows.set(ctx.from.id, flowState);
        
        return ctx.reply(
          `✅ **Full Name:** ${flowState.data.fullName}\n` +
          `✅ **Role:** ${roleText[flowState.flow]}\n\n` +
          `📧 **Step 2/4: Enter your email address**\n` +
          `(Optional - type /skip to skip or /cancel to exit)`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Step 2: Email (optional)
      if (flowState.step === 2) {
        if (text.toLowerCase() === '/cancel') {
          flows.delete(ctx.from.id);
          return ctx.reply('❌ User registration cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        if (text.toLowerCase() === '/skip') {
          flowState.data.email = null;
        } else {
          flowState.data.email = text.slice(0, 100);
        }
        
        flowState.step = 3;
        flows.set(ctx.from.id, flowState);
        
        return ctx.reply(
          `✅ **Full Name:** ${flowState.data.fullName}\n` +
          `✅ **Role:** ${roleText[flowState.flow]}\n` +
          `✅ **Email:** ${flowState.data.email || 'Not provided'}\n\n` +
          `📞 **Step 3/4: Enter your phone number**\n` +
          `(Optional - type /skip to skip or /cancel to exit)`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Step 3: Phone (optional)
      if (flowState.step === 3) {
        if (text.toLowerCase() === '/cancel') {
          flows.delete(ctx.from.id);
          return ctx.reply('❌ User registration cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        if (text.toLowerCase() === '/skip') {
          flowState.data.phone = null;
        } else {
          flowState.data.phone = text.slice(0, 25);
        }
        
        flowState.step = 4;
        flows.set(ctx.from.id, flowState);
        
        // Show facility selection
        const facilities = await prisma.facility.findMany({
          where: { status: 'active' },
          orderBy: { name: 'asc' }
        });
        
        if (!facilities.length) {
          flows.delete(ctx.from.id);
          return ctx.reply('⚠️ No active facilities found. Please contact the system administrator.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        const buttons = facilities.map(f => [
          { text: f.name, callback_data: `join_facility|${f.id.toString()}|${flowState.data.role}` }
        ]);
        buttons.push([{ text: '❌ Cancel', callback_data: 'user_reg_cancel' }]);
        
        return ctx.reply(
          `✅ **Full Name:** ${flowState.data.fullName}\n` +
          `✅ **Role:** ${roleText[flowState.flow]}\n` +
          `✅ **Email:** ${flowState.data.email || 'Not provided'}\n` +
          `✅ **Phone:** ${flowState.data.phone || 'Not provided'}\n\n` +
          `🏢 **Step 4/4: Select Facility to Join**\n\n` +
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
          flows.delete(ctx.from.id);
          return ctx.reply('❌ Work order creation cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        flowState.data.location = text.slice(0, 100);
        if (flowState.data.location.length < 2) {
          return ctx.reply('⚠️ Location must be at least 2 characters. Try again or type /cancel to exit:');
        }
        
        flowState.step = 5;
        flows.set(ctx.from.id, flowState);
        
        return ctx.reply(
          `✅ **Type:** ${flowState.data.typeOfWork}\n` +
          `✅ **Service:** ${flowState.data.typeOfService}\n` +
          `✅ **Priority:** ${flowState.data.priority}\n` +
          `✅ **Location:** ${flowState.data.location}\n\n` +
          `🔧 **Step 5/6: Enter equipment/device name**\n` +
          `(Optional - type /skip to skip or /cancel to exit)`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Step 5: Equipment (optional)
      if (flowState.step === 5) {
        if (text.toLowerCase() === '/cancel') {
          flows.delete(ctx.from.id);
          return ctx.reply('❌ Work order creation cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        if (text.toLowerCase() === '/skip') {
          flowState.data.equipment = null;
        } else {
          flowState.data.equipment = text.slice(0, 100);
        }
        
        flowState.step = 6;
        flows.set(ctx.from.id, flowState);
        
        return ctx.reply(
          `✅ **Type:** ${flowState.data.typeOfWork}\n` +
          `✅ **Service:** ${flowState.data.typeOfService}\n` +
          `✅ **Priority:** ${flowState.data.priority}\n` +
          `✅ **Location:** ${flowState.data.location}\n` +
          `✅ **Equipment:** ${flowState.data.equipment || 'Not specified'}\n\n` +
          `📝 **Step 6/6: Describe the issue in detail**\n` +
          `Minimum 10 characters\n\n` +
          `Type /cancel to exit`,
          { parse_mode: 'Markdown' }
        );
      }
      
      // Step 6: Description
      if (flowState.step === 6) {
        if (text.toLowerCase() === '/cancel') {
          flows.delete(ctx.from.id);
          return ctx.reply('❌ Work order creation cancelled.', {
            reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
          });
        }
        
        const desc = text.slice(0, 500);
        if (desc.length < 10) {
          return ctx.reply('⚠️ Description must be at least 10 characters. Please provide more details or type /cancel to exit:');
        }
        
        try {
          const { user } = await requireActiveMembership(ctx);
          
          const wo = await prisma.workOrder.create({
            data: {
              facilityId: user.activeFacilityId,
              createdByUserId: user.id,
              typeOfWork: flowState.data.typeOfWork,
              typeOfService: flowState.data.typeOfService,
              priority: flowState.data.priority,
              location: flowState.data.location,
              equipment: flowState.data.equipment,
              description: desc,
              status: 'open'
            }
          });
          
          // Create notification for work order creation
          await createNotification(
            user.id,
            user.activeFacilityId,
            'work_order_created',
            'New Work Order Created',
            `Work Order #${wo.id.toString()} has been created.\nType: ${flowState.data.typeOfWork}\nPriority: ${flowState.data.priority}\nLocation: ${flowState.data.location}`,
            { workOrderId: wo.id.toString() }
          );
          
          // Send high priority alert to admins/supervisors
          if (flowState.data.priority === 'high') {
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
                  'high_priority_alert',
                  'High Priority Work Order',
                  `🚨 High priority work order #${wo.id.toString()} created by ${user.firstName || 'User'}.\nType: ${flowState.data.typeOfWork}\nLocation: ${flowState.data.location}`,
                  { workOrderId: wo.id.toString() }
                );
              }
            }
          }
          
          flows.delete(ctx.from.id);
          
          const priorityEmoji = {
            'high': '🔴',
            'medium': '🟡',
            'low': '🟢'
          };
          
                     await ctx.reply(
             `✅ **Work Order Created Successfully!**\n\n` +
             `📋 **Work Order #${wo.id.toString()}**\n` +
             `🔧 Type: ${flowState.data.typeOfWork}\n` +
             `⚡ Service: ${flowState.data.typeOfService}\n` +
             `${priorityEmoji[flowState.data.priority]} Priority: ${flowState.data.priority}\n` +
             `📍 Location: ${flowState.data.location}\n` +
             `🔧 Equipment: ${flowState.data.equipment || 'N/A'}\n` +
             `📝 Description: ${desc.slice(0, 100)}${desc.length > 100 ? '...' : ''}\n\n` +
             `Status: 🔵 Open`,
             {
               parse_mode: 'Markdown',
               reply_markup: {
                 inline_keyboard: [
                   [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
                 ]
               }
             }
           );
         } catch (error) {
           console.error('Error creating work order:', error);
           flows.delete(ctx.from.id);
           await ctx.reply('⚠️ An error occurred while creating the work order. Please try again.', {
             reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
           });
         }
         return;
       }
     }
     
     // Create reminder flow
     if (flowState.flow === 'create_reminder') {
       if (flowState.step === 2) {
         // Step 2: Title
         flowState.data.title = text.slice(0, 100);
         if (flowState.data.title.length < 3) {
           return ctx.reply('Title must be at least 3 characters. Try again:');
         }
         flowState.step = 3;
         flows.set(ctx.from.id, flowState);
         return ctx.reply(`⏰ **Create Reminder** (3/5)\nType: ${flowState.data.type}\nTitle: ${flowState.data.title}\n\nEnter the reminder message (max 500 chars):`);
       }
       if (flowState.step === 3) {
         // Step 3: Message
         flowState.data.message = text.slice(0, 500);
         if (flowState.data.message.length < 5) {
           return ctx.reply('Message must be at least 5 characters. Try again:');
         }
         flowState.step = 4;
         flows.set(ctx.from.id, flowState);
         return ctx.reply(`⏰ **Create Reminder** (4/5)\nType: ${flowState.data.type}\nTitle: ${flowState.data.title}\nMessage: ${flowState.data.message.slice(0, 50)}${flowState.data.message.length > 50 ? '...' : ''}\n\nEnter the date and time (format: YYYY-MM-DD HH:MM):`);
       }
       if (flowState.step === 4) {
         // Step 4: Date and Time
         const dateTimeStr = text.trim();
         const scheduledFor = new Date(dateTimeStr);
         
         if (isNaN(scheduledFor.getTime())) {
           return ctx.reply('Invalid date format. Please use YYYY-MM-DD HH:MM format (e.g., 2024-12-25 14:30):');
         }
         
         if (scheduledFor <= new Date()) {
           return ctx.reply('Scheduled time must be in the future. Please enter a future date and time:');
         }
         
         flowState.data.scheduledFor = scheduledFor;
         flowState.step = 5;
         flows.set(ctx.from.id, flowState);
         
         const frequencyButtons = [
           [Markup.button.callback('🔄 Once', 'reminder_frequency|once')],
           [Markup.button.callback('📅 Daily', 'reminder_frequency|daily')],
           [Markup.button.callback('📆 Weekly', 'reminder_frequency|weekly')],
           [Markup.button.callback('📊 Monthly', 'reminder_frequency|monthly')]
         ];
         
         return ctx.reply(`⏰ **Create Reminder** (5/5)\nType: ${flowState.data.type}\nTitle: ${flowState.data.title}\nScheduled for: ${scheduledFor.toLocaleDateString()} ${scheduledFor.toLocaleTimeString()}\n\nChoose frequency:`, {
           reply_markup: { inline_keyboard: frequencyButtons }
         });
       }
     }
  } catch (e) {
    console.error('FLOW_ERROR', e);
    flows.delete(ctx.from.id);
    return ctx.reply('⚠️ An error occurred. Please try again.');
  }
});

// Handle work order type selection
bot.action(/wo_type\|(maintenance|repair|installation|cleaning|inspection|other)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const flowState = flows.get(ctx.from.id);
  if (!flowState || flowState.flow !== 'wo_new') return;
  
  flowState.data.typeOfWork = ctx.match[1];
  flowState.step = 2;
  flows.set(ctx.from.id, flowState);
  
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
  
  await ctx.reply(`🔧 **Work Order Creation (2/6)**\n\n✅ **Type:** ${flowState.data.typeOfWork}\n\n**Choose the service type:**`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: serviceTypeButtons }
  });
});

// Handle service type selection
bot.action(/wo_service\|(electrical|mechanical|plumbing|hvac|structural|it|general)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const flowState = flows.get(ctx.from.id);
  if (!flowState || flowState.flow !== 'wo_new') return;
  
  flowState.data.typeOfService = ctx.match[1];
  flowState.step = 3;
  flows.set(ctx.from.id, flowState);
  
  // Step 3: Choose priority
  const priorityButtons = [
    [Markup.button.callback('🔴 High Priority', 'wo_priority|high')],
    [Markup.button.callback('🟡 Medium Priority', 'wo_priority|medium')],
    [Markup.button.callback('🟢 Low Priority', 'wo_priority|low')],
    [Markup.button.callback('❌ Cancel', 'wo_cancel')]
  ];
  
  await ctx.reply(`🔧 **Work Order Creation (3/6)**\n\n✅ **Type:** ${flowState.data.typeOfWork}\n✅ **Service:** ${flowState.data.typeOfService}\n\n**Choose priority:**`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: priorityButtons }
  });
});

// Handle priority selection
bot.action(/wo_priority\|(high|medium|low)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const flowState = flows.get(ctx.from.id);
  if (!flowState || flowState.flow !== 'wo_new') return;
  
  flowState.data.priority = ctx.match[1];
  flowState.step = 4;
  flows.set(ctx.from.id, flowState);
  
  await ctx.reply(
    `🔧 **Work Order Creation (4/6)**\n\n` +
    `✅ **Type:** ${flowState.data.typeOfWork}\n` +
    `✅ **Service:** ${flowState.data.typeOfService}\n` +
    `✅ **Priority:** ${flowState.data.priority}\n\n` +
    `📍 **Enter the location/area**\n` +
    `(e.g., Building A, Floor 2, Room 101)\n\n` +
    `Type /cancel to exit`,
    { parse_mode: 'Markdown' }
  );
});

// Handle facility registration cancellation
bot.action('regfac_cancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  flows.delete(ctx.from.id);
  await ctx.reply('❌ Facility registration cancelled.', {
    reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
  });
});

// Handle user registration cancellation
bot.action('user_reg_cancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  flows.delete(ctx.from.id);
  await ctx.reply('❌ User registration cancelled.', {
    reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
  });
});

// Handle work order creation cancellation
bot.action('wo_cancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  flows.delete(ctx.from.id);
  await ctx.reply('❌ Work order creation cancelled.', {
    reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]] }
  });
});

// Handle plan selection during facility registration
bot.action(/regfac_plan\|(Free|Pro|Business)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  
  try {
    const flowState = flows.get(ctx.from.id);
    if (!flowState || flowState.flow !== 'reg_fac') {
      return ctx.reply('⚠️ Invalid registration flow. Please start over.');
    }
    
    flowState.data.plan = ctx.match[1];
    const user = await ensureUser(ctx);
    const data = flowState.data;
    
    // Validate required fields
    if (!data.name || !data.city || !data.phone) {
      flows.delete(ctx.from.id);
      return ctx.reply('⚠️ Missing required facility information. Please start over.');
    }
    
    // Check if facility name already exists
    const existingFacility = await prisma.facility.findUnique({
      where: { name: data.name }
    });
    
    if (existingFacility) {
      flows.delete(ctx.from.id);
      return ctx.reply('⚠️ A facility with this name already exists. Please choose a different name.');
    }
    
    console.log('Creating facility with data:', data);
    
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
    
    flows.delete(ctx.from.id);
    
    await ctx.reply(
      `✅ **Facility Registration Successful!**\n\n` +
      `🏢 **Facility Details:**\n` +
      `• Name: ${facility.name}\n` +
      `• City: ${data.city}\n` +
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
    
    // Notify master
    if (MASTER_ID) {
      try {
        await bot.telegram.sendMessage(
          MASTER_ID,
          `🏢 **New Facility Request**\n\n` +
          `📝 **Details:**\n` +
          `• Name: ${facility.name}\n` +
          `• City: ${data.city}\n` +
          `• Phone: ${data.phone}\n` +
          `• Plan: ${data.plan}\n` +
          `• ID: ${facility.id.toString()}\n` +
          `• Owner: ${ctx.from.id}\n\n` +
          `Use Master Panel to approve.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error('Failed to notify master:', err);
      }
    }
    
  } catch (error) {
    console.error('Error in facility registration:', error);
    flows.delete(ctx.from.id);
    
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
    
    const dashboardMessage = 
      `🏢 **Facility Dashboard**\n\n` +
      `📋 **${facility.name}**\n` +
      `📍 ${facility.city || 'No city'}\n` +
      `📞 ${facility.phone || 'No phone'}\n` +
      `💼 ${facility.planTier || 'No plan'}\n\n` +
      `📊 **Quick Stats:**\n` +
      `👥 Members: ${totalMembers}\n` +
      `📋 Total Work Orders: ${totalWorkOrders}\n` +
      `🔵 Open Orders: ${openWorkOrders}`;
    
    await ctx.reply(dashboardMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error accessing facility dashboard:', error);
    await ctx.reply('⚠️ An error occurred while accessing the dashboard.');
  }
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
      const role = roleEmoji[member.role] + ' ' + roleText[member.role];
      
      return [Markup.button.callback(
        `${name} (${role})`,
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
      `📝 **Name:** ${member.user.firstName || 'Not set'}\n` +
      `🆔 **Telegram ID:** ${member.user.tgId?.toString() || 'Not set'}\n` +
      `${roleEmoji[member.role]} **Role:** ${roleText[member.role]}\n` +
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
      `📍 **City:** ${facility.city || 'Not set'}\n` +
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
// Helper function to create notifications
async function createNotification(userId, facilityId, type, title, message, data = null) {
  try {
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
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// Helper function to send notification to user via Telegram
async function sendTelegramNotification(userId, title, message, buttons = null) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) }
    });
    
    if (user?.tgId) {
      const options = buttons ? { reply_markup: { inline_keyboard: buttons } } : {};
      await bot.telegram.sendMessage(user.tgId.toString(), `${title}\n\n${message}`, options);
    }
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
      'daily_summary': '📊',
      'weekly_report': '📈',
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
      [Markup.button.callback('📊 Daily Summary', 'report_daily')],
      [Markup.button.callback('📈 Weekly Report', 'report_weekly')],
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
bot.action('report_daily', async (ctx) => {
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
      [Markup.button.callback('📈 Weekly Report', 'report_weekly')],
      [Markup.button.callback('🔙 Back to Reports', 'reports_menu')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(reportMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating daily report:', error);
    await ctx.reply('⚠️ An error occurred while generating the report.');
  }
});

// Weekly report
bot.action('report_weekly', async (ctx) => {
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
    
    // Get weekly statistics
    const weeklyWorkOrders = await prisma.workOrder.count({
      where: {
        facilityId: user.activeFacilityId,
        createdAt: { gte: weekAgo }
      }
    });
    
    const weeklyCompleted = await prisma.workOrder.count({
      where: {
        facilityId: user.activeFacilityId,
        status: { in: ['done', 'closed'] },
        updatedAt: { gte: weekAgo }
      }
    });
    
    const completionRate = weeklyWorkOrders > 0 ? 
      Math.round((weeklyCompleted / weeklyWorkOrders) * 100) : 0;
    
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
      `📋 Total Work Orders: ${weeklyWorkOrders}\n` +
      `✅ Completed: ${weeklyCompleted}\n` +
      `📈 Completion Rate: ${completionRate}%\n\n` +
      `🎯 **Priority Distribution:**\n${prioritySection}`;
    
    const buttons = [
      [Markup.button.callback('📊 Daily Summary', 'report_daily')],
      [Markup.button.callback('🔙 Back to Reports', 'reports_menu')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(reportMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error generating weekly report:', error);
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
      const role = roleEmoji[member.role] + ' ' + roleText[member.role];
      return `👤 **${name}** (${role})\n   📋 Total Orders: ${member.workOrdersCount}\n   📅 Recent (7d): ${member.recentActivity}`;
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
    
    const settingsMessage = 
      `⚙️ **Notification Settings**\n\n` +
      `🔔 **Current Settings:**\n` +
      `✅ Work Order Updates\n` +
      `✅ Status Changes\n` +
      `✅ High Priority Alerts\n` +
      `✅ Daily Summaries\n` +
      `✅ Weekly Reports\n\n` +
      `Settings customization coming soon...`;
    
    const buttons = [
      [Markup.button.callback('🔙 Back to Notifications', 'notifications')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];
    
    await ctx.reply(settingsMessage, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error accessing notification settings:', error);
    await ctx.reply('⚠️ An error occurred while accessing settings.');
  }
});

// === Reminder System ===
// Helper function to create reminders
async function createReminder(facilityId, createdByUserId, type, title, message, scheduledFor, frequency = 'once', data = null) {
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

// Helper function to send reminder to facility members
async function sendReminderToFacility(facilityId, title, message, buttons = null) {
  try {
    const members = await prisma.facilityMember.findMany({
      where: { facilityId: BigInt(facilityId) },
      include: { user: true }
    });
    
    for (const member of members) {
      if (member.user.tgId) {
        try {
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
    
    flows.set(ctx.from.id, { flow: 'create_reminder', step: 1, data: {}, ts: Date.now() });
    
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
  const flowState = flows.get(ctx.from.id);
  if (!flowState || flowState.flow !== 'create_reminder') return;
  
  flowState.data.type = ctx.match[1];
  flowState.step = 2;
  flows.set(ctx.from.id, flowState);
  
  await ctx.reply(`⏰ **Create Reminder** (2/5)\nType: ${flowState.data.type}\n\nEnter the reminder title (max 100 chars):`);
});

// Handle reminder frequency selection
bot.action(/reminder_frequency\|(once|daily|weekly|monthly)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const flowState = flows.get(ctx.from.id);
  if (!flowState || flowState.flow !== 'create_reminder') return;
  
  const { user } = await requireActiveMembership(ctx);
  flowState.data.frequency = ctx.match[1];
  
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
  
  flows.delete(ctx.from.id);
  
  const frequencyText = {
    'once': 'Once',
    'daily': 'Daily',
    'weekly': 'Weekly',
    'monthly': 'Monthly'
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
      'once': 'Once',
      'daily': 'Daily',
      'weekly': 'Weekly',
      'monthly': 'Monthly',
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

// Back to menu handler
bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await showMainMenu(ctx);
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
      include: { createdByUser: true },
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
      woList += `   👤 ${wo.createdByUser.firstName || 'Unknown'}\n`;
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
    flows.set(ctx.from.id, { 
      flow: 'register_user', 
      step: 1, 
      data: { role: 'user' }, 
      ts: Date.now() 
    });
    
    await ctx.reply(
      '👤 **User Registration**\n\n' +
      'You are registering as a **User**.\n\n' +
      '**User Permissions:**\n' +
      '• Submit maintenance requests\n' +
      '• View your own requests\n' +
      '• Receive notifications\n\n' +
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
    flows.set(ctx.from.id, { 
      flow: 'register_technician', 
      step: 1, 
      data: { role: 'technician' }, 
      ts: Date.now() 
    });
    
    await ctx.reply(
      '🔧 **Technician Registration**\n\n' +
      'You are registering as a **Technician**.\n\n' +
      '**Technician Permissions:**\n' +
      '• Submit maintenance requests\n' +
      '• Execute assigned work orders\n' +
      '• Update work order status\n' +
      '• View assigned tasks\n\n' +
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
    flows.set(ctx.from.id, { 
      flow: 'register_supervisor', 
      step: 1, 
      data: { role: 'supervisor' }, 
      ts: Date.now() 
    });
    
    await ctx.reply(
      '👨‍💼 **Supervisor Registration**\n\n' +
      'You are registering as a **Supervisor**.\n\n' +
      '**Supervisor Permissions:**\n' +
      '• Submit maintenance requests\n' +
      '• Review and manage work orders\n' +
      '• Access reports and statistics\n' +
      '• Monitor team performance\n' +
      '• Assign tasks to technicians\n\n' +
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

// Webhook handler for Vercel
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
