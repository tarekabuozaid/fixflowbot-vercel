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

async function showMainMenu(ctx) {
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
    }
    
    // Add notifications button
    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false }
    });
    
    const notificationText = unreadCount > 0 ? `🔔 Notifications (${unreadCount})` : '🔔 Notifications';
    buttons.push([Markup.button.callback(notificationText, 'notifications')]);
    
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
  } else {
    buttons.push([Markup.button.callback('🏢 Register Facility', 'reg_fac_start')]);
    buttons.push([Markup.button.callback('🔗 Join Facility', 'join_fac_start')]);
  }
  if (isMaster(ctx)) {
    buttons.push([Markup.button.callback('🛠 Master Panel', 'master_panel')]);
  }
  await ctx.reply('👋 Welcome to FixFlow! What would you like to do?', {
    reply_markup: { inline_keyboard: buttons }
  });
}

bot.start(async (ctx) => {
  await showMainMenu(ctx);
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
  const facs = await prisma.facility.findMany({ where: { isActive: true }, take: 20 });
  if (!facs.length) {
    return ctx.reply('⚠️ No active facilities available to join at this time.');
  }
  const rows = facs.map(f => [Markup.button.callback(`${f.name}`, `join_fac|${f.id.toString()}`)]);
  await ctx.reply('Please choose a facility to request membership:', { reply_markup: { inline_keyboard: rows } });
}

bot.action(/join_fac\|(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const facId = BigInt(ctx.match[1]);
  const user = await ensureUser(ctx);
  // Create switch request
  await prisma.facilitySwitchRequest.create({
    data: { userId: user.id, toFacilityId: facId, status: 'pending' }
  });
  // Notify master
  if (MASTER_ID) {
    await bot.telegram.sendMessage(MASTER_ID, `🆕 User ${ctx.from.id} requested to join facility #${facId.toString()}`);
  }
  await ctx.reply('✅ Your join request has been submitted and is pending approval.');
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
    // Facility Registration flow
    if (flowState.flow === 'reg_fac') {
      if (flowState.step === 1) {
        flowState.data.name = text.slice(0, 60);
        if (flowState.data.name.length < 2) {
          return ctx.reply('Name must be at least 2 characters. Try again:');
        }
        flowState.step = 2;
        flows.set(ctx.from.id, flowState);
        return ctx.reply('🏙️ Facility Registration (2/4)\nEnter the city (max 40 chars):');
      }
      if (flowState.step === 2) {
        flowState.data.city = text.slice(0, 40);
        if (flowState.data.city.length < 2) {
          return ctx.reply('City must be at least 2 characters. Try again:');
        }
        flowState.step = 3;
        flows.set(ctx.from.id, flowState);
        return ctx.reply('📞 Facility Registration (3/4)\nEnter a contact phone (max 25 chars):');
      }
      if (flowState.step === 3) {
        flowState.data.phone = text.slice(0, 25);
        flowState.step = 4;
        flows.set(ctx.from.id, flowState);
        const planButtons = ['Free', 'Pro', 'Business'].map(p => [Markup.button.callback(p, `regfac_plan|${p}`)]);
        return ctx.reply('💼 Facility Registration (4/4)\nChoose a subscription plan:', { reply_markup: { inline_keyboard: planButtons } });
      }
      // Step 4 handled via callback
    }
         // Work order flow
     if (flowState.flow === 'wo_new') {
       if (flowState.step === 4) {
         // Step 4: Location
         flowState.data.location = text.slice(0, 100);
         if (flowState.data.location.length < 2) {
           return ctx.reply('Location must be at least 2 characters. Try again:');
         }
         flowState.step = 5;
         flows.set(ctx.from.id, flowState);
         return ctx.reply(`🔧 Work Order Creation (5/6)\nType: ${flowState.data.typeOfWork}\nService: ${flowState.data.typeOfService}\nPriority: ${flowState.data.priority}\nLocation: ${flowState.data.location}\n\n🔧 Enter equipment/device name (optional, press /skip to skip):`);
       }
       if (flowState.step === 5) {
         // Step 5: Equipment (optional)
         if (text.toLowerCase() === '/skip') {
           flowState.data.equipment = null;
         } else {
           flowState.data.equipment = text.slice(0, 100);
         }
         flowState.step = 6;
         flows.set(ctx.from.id, flowState);
         return ctx.reply(`🔧 Work Order Creation (6/6)\nType: ${flowState.data.typeOfWork}\nService: ${flowState.data.typeOfService}\nPriority: ${flowState.data.priority}\nLocation: ${flowState.data.location}\nEquipment: ${flowState.data.equipment || 'N/A'}\n\n📝 Please describe the issue in detail:`);
       }
       if (flowState.step === 6) {
         // Step 6: Description
         const desc = text.slice(0, 500);
         if (desc.length < 10) {
           return ctx.reply('Description must be at least 10 characters. Please provide more details:');
         }
         
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
           `✅ Work Order Created Successfully!\n\n` +
           `📋 **Work Order #${wo.id.toString()}**\n` +
           `🔧 Type: ${flowState.data.typeOfWork}\n` +
           `⚡ Service: ${flowState.data.typeOfService}\n` +
           `${priorityEmoji[flowState.data.priority]} Priority: ${flowState.data.priority}\n` +
           `📍 Location: ${flowState.data.location}\n` +
           `🔧 Equipment: ${flowState.data.equipment || 'N/A'}\n` +
           `📝 Description: ${desc.slice(0, 100)}${desc.length > 100 ? '...' : ''}\n\n` +
           `Status: 🔵 Open`,
           {
             reply_markup: {
               inline_keyboard: [
                 [Markup.button.callback('🏠 Back to Menu', 'back_to_menu')]
               ]
             }
           }
         );
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
    [Markup.button.callback('🧹 General', 'wo_service|general')]
  ];
  
  await ctx.reply(`🔧 Work Order Creation (2/6)\nType: ${flowState.data.typeOfWork}\nChoose the service type:`, {
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
    [Markup.button.callback('🟢 Low Priority', 'wo_priority|low')]
  ];
  
  await ctx.reply(`🔧 Work Order Creation (3/6)\nType: ${flowState.data.typeOfWork}\nService: ${flowState.data.typeOfService}\nChoose priority:`, {
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
  
  await ctx.reply(`🔧 Work Order Creation (4/6)\nType: ${flowState.data.typeOfWork}\nService: ${flowState.data.typeOfService}\nPriority: ${flowState.data.priority}\n\n📍 Enter the location/area (e.g., Building A, Floor 2, Room 101):`);
});

// Handle plan selection during facility registration
bot.action(/regfac_plan\|(Free|Pro|Business)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const flowState = flows.get(ctx.from.id);
  if (!flowState || flowState.flow !== 'reg_fac') return;
  flowState.data.plan = ctx.match[1];
  // Create facility in DB
  const user = await ensureUser(ctx);
  const data = flowState.data;
  const facility = await prisma.$transaction(async (tx) => {
    const f = await tx.facility.create({
      data: {
        name: data.name,
        city: data.city,
        phone: data.phone,
        isActive: false,
        isDefault: false,
        planTier: data.plan
      }
    });
    await tx.facilityMember.create({
      data: { userId: user.id, facilityId: f.id, role: 'facility_admin' }
    });
    await tx.user.update({
      where: { id: user.id },
      data: {
        activeFacilityId: f.id,
        requestedRole: 'facility_admin'
      }
    });
    return f;
  });
  flows.delete(ctx.from.id);
  await ctx.reply(
    `✅ Facility registration submitted!\n` +
    `• Name: ${facility.name}\n` +
    `• City: ${data.city}\n` +
    `• Phone: ${data.phone}\n` +
    `• Plan: ${data.plan}\n` +
    `• Status: pending (awaiting activation)`
  );
  // Notify master
  if (MASTER_ID) {
    try {
      await bot.telegram.sendMessage(
        MASTER_ID,
        `🏢 New facility request\n• Name: ${facility.name}\n• City: ${data.city}\n• Phone: ${data.phone}\n• Plan: ${data.plan}\n• ID: ${facility.id.toString()}\n• Owner: ${ctx.from.id}`
      );
    } catch (err) {
      console.error('Failed to notify master', err);
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
  const pending = await prisma.facility.findMany({ where: { isActive: false } });
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
  await prisma.facility.update({ where: { id: facId }, data: { isActive: true } });
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
    include: { user: true }
  });
  if (!requests.length) {
    return ctx.reply('No pending membership requests.');
  }
  const rows = requests.map(r => [
    Markup.button.callback(
      `User ${r.user.tgId?.toString() || r.user.id.toString()} → #${r.toFacilityId.toString()}`,
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
        facilityId: req.toFacilityId,
        role: 'user'
      }
    });
    await tx.user.update({
      where: { id: req.userId },
      data: {
        status: 'active',
        activeFacilityId: req.toFacilityId
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
