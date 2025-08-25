// api/telegram/index.js
// FixFlowBot – Improved version with better architecture

const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

// === Configuration & Validation ===
const CONFIG = {
  TOKEN: process.env.BOT_TOKEN,
  PUBLIC_URL: process.env.PUBLIC_URL,
  MASTER_ID: String(process.env.MASTER_ID || ''),
  WEBHOOK_PATH: '/api/telegram',
  ALLOWED_UPDATES: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
  HANDLER_TIMEOUT: 9000,
  COOLDOWN_TIME: 60 * 1000, // 1 minute
  PAGE_SIZE: 5,
  MAX_TEXT_LENGTH: {
    facilityName: 60,
    city: 40,
    phone: 25,
    description: 500,
    department: 50
  }
};

// Validate required environment variables
if (!CONFIG.TOKEN || !CONFIG.PUBLIC_URL) {
  console.error('Missing required environment variables: BOT_TOKEN or PUBLIC_URL');
  module.exports = (req, res) => {
    res.statusCode = 500;
    res.end('Server configuration error');
  };
  module.exports.config = { runtime: 'nodejs20' };
  return;
}

// === Database Connection ===
const getPrismaClient = () => {
  if (globalThis._prisma) return globalThis._prisma;
  globalThis._prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });
  return globalThis._prisma;
};

const prisma = getPrismaClient();

// === State Management ===
class StateManager {
  constructor() {
    this.userFlows = globalThis._userFlows || new Map();
    this.cooldowns = globalThis._cooldowns || new Map();
    this.userSessions = globalThis._userSessions || new Map();
    
    if (!globalThis._userFlows) globalThis._userFlows = this.userFlows;
    if (!globalThis._cooldowns) globalThis._cooldowns = this.cooldowns;
    if (!globalThis._userSessions) globalThis._userSessions = this.userSessions;
  }

  setUserFlow(userId, flowData) {
    this.userFlows.set(userId, { ...flowData, timestamp: Date.now() });
  }

  getUserFlow(userId) {
    const flow = this.userFlows.get(userId);
    if (!flow) return null;
    
    // Clean up old flows (older than 10 minutes)
    if (Date.now() - flow.timestamp > 10 * 60 * 1000) {
      this.userFlows.delete(userId);
      return null;
    }
    return flow;
  }

  clearUserFlow(userId) {
    this.userFlows.delete(userId);
  }

  setCooldown(key, duration = CONFIG.COOLDOWN_TIME) {
    this.cooldowns.set(key, Date.now() + duration);
  }

  isInCooldown(key) {
    const cooldownEnd = this.cooldowns.get(key);
    if (!cooldownEnd) return false;
    
    if (Date.now() > cooldownEnd) {
      this.cooldowns.delete(key);
      return false;
    }
    return true;
  }
}

const stateManager = new StateManager();

// === Input Validation ===
class Validator {
  static sanitizeText(text, maxLength) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().slice(0, maxLength);
  }

  static validateFacilityData(data) {
    const errors = [];
    
    if (!data.name || data.name.length < 2) {
      errors.push('Facility name must be at least 2 characters');
    }
    if (!data.city || data.city.length < 2) {
      errors.push('City must be at least 2 characters');
    }
    if (!data.phone || !/^[\d\s\+\-\(\)]{7,}$/.test(data.phone)) {
      errors.push('Valid phone number is required');
    }
    
    return errors;
  }

  static validateWorkOrder(data) {
    const errors = [];
    const validDepartments = ['civil', 'electrical', 'mechanical', 'general'];
    const validPriorities = ['low', 'medium', 'high'];
    
    if (!validDepartments.includes(data.department?.toLowerCase())) {
      errors.push('Department must be: civil, electrical, mechanical, or general');
    }
    if (!validPriorities.includes(data.priority?.toLowerCase())) {
      errors.push('Priority must be: low, medium, or high');
    }
    if (!data.description || data.description.length < 5) {
      errors.push('Description must be at least 5 characters');
    }
    
    return errors;
  }
}

// === Database Operations ===
class DatabaseService {
  static async ensureUser(ctx) {
    try {
      const tgId = BigInt(ctx.from.id);
      let user = await prisma.user.findUnique({ where: { tgId } });
      
      if (!user) {
        user = await prisma.user.create({
          data: {
            tgId,
            firstName: Validator.sanitizeText(ctx.from.first_name, 50),
            status: 'pending'
          }
        });
      }
      
      return user;
    } catch (error) {
      console.error('DATABASE_ERROR [ensureUser]:', error);
      throw new Error('Database operation failed');
    }
  }

  static async getUserMembership(userId, facilityId) {
    try {
      return await prisma.facilityMember.findFirst({
        where: { userId, facilityId },
        include: { facility: true }
      });
    } catch (error) {
      console.error('DATABASE_ERROR [getUserMembership]:', error);
      return null;
    }
  }

  static async createFacility(data, userId) {
    try {
      return await prisma.$transaction(async (tx) => {
        const facility = await tx.facility.create({
          data: {
            name: data.name,
            isDefault: false,
            isActive: false,
            planTier: 'Free'
          }
        });

        await tx.facilityMember.create({
          data: {
            userId,
            facilityId: facility.id,
            role: 'facility_admin'
          }
        });

        await tx.user.update({
          where: { id: userId },
          data: {
            activeFacilityId: facility.id,
            requestedRole: 'facility_admin'
          }
        });

        return facility;
      });
    } catch (error) {
      console.error('DATABASE_ERROR [createFacility]:', error);
      throw new Error('Failed to create facility');
    }
  }
}

// === Authorization ===
class AuthService {
  static async requireMembership(ctx) {
    const user = await DatabaseService.ensureUser(ctx);
    
    if (!user.activeFacilityId) {
      throw new Error('no_active_facility');
    }
    
    const member = await DatabaseService.getUserMembership(user.id, user.activeFacilityId);
    if (!member) {
      throw new Error('no_membership');
    }
    
    return { user, member };
  }

  static assertRole(member, ...allowedRoles) {
    if (!member || !allowedRoles.includes(member.role)) {
      throw new Error('insufficient_permissions');
    }
  }

  static isMaster(ctx) {
    return String(ctx.from?.id || '') === CONFIG.MASTER_ID;
  }
}

// === UI Components ===
class UIComponents {
  static createInlineKeyboard(rows) {
    return { reply_markup: { inline_keyboard: rows } };
  }

  static async sendMainMenu(ctx) {
    try {
      const user = await DatabaseService.ensureUser(ctx);
      const rows = [];

      if (user.status !== 'active' || !user.activeFacilityId) {
        rows.push([
          Markup.button.callback('🆕 Register Facility', 'start_reg_fac'),
          Markup.button.callback('👥 Join Facility', 'start_join')
        ]);
      } else {
        const member = await DatabaseService.getUserMembership(user.id, user.activeFacilityId);
        rows.push([
          Markup.button.callback('➕ New Issue', 'wo:start_new'),
          Markup.button.callback('📋 My Issues', 'wo:my|1|all')
        ]);

        if (member && ['facility_admin', 'supervisor', 'technician'].includes(member.role)) {
          rows.push([Markup.button.callback('🔧 Manage Requests', 'wo:manage|1|all')]);
        }
      }

      rows.push([Markup.button.callback('ℹ️ Help', 'help')]);
      
      await ctx.reply('🏠 Main Menu:', Markup.inlineKeyboard(rows));
    } catch (error) {
      console.error('UI_ERROR [sendMainMenu]:', error);
      await ctx.reply('❌ Error loading menu. Please try /start again.');
    }
  }

  static async sendOnboardingMenu(ctx) {
    try {
      await ctx.reply(
        '👋 Welcome to FixFlow! Choose how to start:',
        Markup.inlineKeyboard([
          [Markup.button.callback('🆕 Register New Facility', 'start_reg_fac')],
          [Markup.button.callback('👥 Join Existing Facility', 'start_join')],
          [Markup.button.callback('ℹ️ Get Help', 'help')]
        ])
      );
    } catch (error) {
      console.error('UI_ERROR [sendOnboardingMenu]:', error);
    }
  }
}

// === Bot Creation ===
const bot = new Telegraf(CONFIG.TOKEN, {
  handlerTimeout: CONFIG.HANDLER_TIMEOUT
});

// === Global Error Handler ===
bot.catch((err, ctx) => {
  console.error('TELEGRAM_ERROR:', {
    error: err.stack || err.message,
    userId: ctx?.from?.id,
    updateType: ctx?.updateType
  });

  try {
    if (ctx.answerCbQuery) {
      ctx.answerCbQuery('❌ An error occurred. Please try again.').catch(() => {});
    }
  } catch (e) {
    console.error('Error in error handler:', e);
  }
});

// === Middleware ===
bot.use(async (ctx, next) => {
  // Rate limiting
  const userId = ctx.from?.id;
  if (userId && stateManager.isInCooldown(`rate_${userId}`)) {
    return; // Silently ignore if rate limited
  }

  if (userId) {
    stateManager.setCooldown(`rate_${userId}`, 1000); // 1 second rate limit
  }

  // Log requests
  console.log('REQUEST:', {
    userId,
    updateType: ctx.updateType,
    text: ctx.message?.text?.slice(0, 50)
  });

  return next();
});

// === Commands Setup ===
if (!globalThis._commandsSet) {
  globalThis._commandsSet = true;
  bot.telegram.setMyCommands([
    { command: 'start', description: 'Start using the bot' },
    { command: 'ping', description: 'Check bot status' },
    { command: 'me', description: 'View my profile' },
    { command: 'help', description: 'Get help' },
    { command: 'menu', description: 'Show main menu' }
  ]).catch(console.error);
}

// === Basic Commands ===
bot.command('ping', (ctx) => ctx.reply('🏓 Pong! Bot is working.'));

bot.command(['start', 'menu'], async (ctx) => {
  try {
    const cooldownKey = `start_${ctx.chat.id}`;
    if (stateManager.isInCooldown(cooldownKey)) {
      return; // Avoid spam
    }
    
    stateManager.setCooldown(cooldownKey);
    await UIComponents.sendMainMenu(ctx);
  } catch (error) {
    console.error('START_ERROR:', error);
    await ctx.reply('❌ Error loading menu. Please try again.');
  }
});

bot.command('help', (ctx) => {
  const helpText = `🆘 **FixFlow Help**

**Commands:**
• /start - Main menu
• /me - View your profile
• /ping - Check bot status
• /help - This help message

**Getting Started:**
1️⃣ Register a new facility or join existing one
2️⃣ Create maintenance requests
3️⃣ Track and manage issues

**Roles:**
• **User** - Create and view own requests
• **Technician** - Manage assigned requests  
• **Supervisor** - Oversee department requests
• **Admin** - Full facility management

Need more help? Contact support.`;

  ctx.replyWithMarkdown(helpText);
});

bot.command('me', async (ctx) => {
  try {
    const user = await DatabaseService.ensureUser(ctx);
    const facility = user.activeFacilityId 
      ? await prisma.facility.findUnique({ where: { id: user.activeFacilityId } })
      : null;
    const member = user.activeFacilityId
      ? await DatabaseService.getUserMembership(user.id, user.activeFacilityId)
      : null;

    const profileText = `👤 **Your Profile**

**ID:** ${user.id}
**Telegram ID:** ${ctx.from.id}
**Status:** ${user.status}
**Name:** ${ctx.from.first_name || 'Not set'}

🏢 **Active Facility:** ${facility?.name || 'None'}
👥 **Role:** ${member?.role || 'None'}
${user.requestedRole ? `🔄 **Requested Role:** ${user.requestedRole}` : ''}`;

    await ctx.replyWithMarkdown(profileText);
  } catch (error) {
    console.error('ME_COMMAND_ERROR:', error);
    await ctx.reply('❌ Error retrieving profile information.');
  }
});

// === Smart Welcome Middleware ===
bot.use(async (ctx, next) => {
  try {
    // Skip for callbacks and commands
    if (ctx.updateType === 'callback_query' || ctx.message?.text?.startsWith('/')) {
      return next();
    }

    // Skip if user is in active flow
    if (stateManager.getUserFlow(ctx.from?.id)) {
      return next();
    }

    // Skip bot messages
    if (ctx.message?.from?.is_bot) {
      return;
    }

    const user = await DatabaseService.ensureUser(ctx);
    if (user.status !== 'active' || !user.activeFacilityId) {
      const cooldownKey = `welcome_${ctx.chat.id}`;
      if (!stateManager.isInCooldown(cooldownKey)) {
        stateManager.setCooldown(cooldownKey);
        await UIComponents.sendOnboardingMenu(ctx);
      }
    }

    return next();
  } catch (error) {
    console.error('WELCOME_MIDDLEWARE_ERROR:', error);
    return next();
  }
});

// === Action Handlers ===
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  bot.handleUpdate({ ...ctx.update, message: { ...ctx.update.callback_query.message, text: '/help' } });
});

bot.action('back_main', async (ctx) => {
  await ctx.answerCbQuery();
  await UIComponents.sendMainMenu(ctx);
});

// === Facility Registration Flow ===
bot.action('start_reg_fac', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    stateManager.setUserFlow(ctx.from.id, {
      type: 'facility_registration',
      step: 1,
      data: {}
    });

    await ctx.editMessageText(
      '🏢 **Facility Registration**\n\nStep 1/3: Enter facility name:',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('FACILITY_REG_START_ERROR:', error);
    await ctx.reply('❌ Failed to start registration. Please try again.');
  }
});

// === Text Message Handler for Flows ===
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const flow = stateManager.getUserFlow(userId);
  
  if (!flow) return;

  try {
    if (flow.type === 'facility_registration') {
      await handleFacilityRegistrationFlow(ctx, flow);
    } else if (flow.type === 'work_order_creation') {
      await handleWorkOrderFlow(ctx, flow);
    }
  } catch (error) {
    console.error('FLOW_HANDLER_ERROR:', error);
    stateManager.clearUserFlow(userId);
    await ctx.reply('❌ An error occurred. Flow cancelled. Please try again.');
  }
});

async function handleFacilityRegistrationFlow(ctx, flow) {
  const text = ctx.message.text.trim();
  
  if (flow.step === 1) {
    flow.data.name = Validator.sanitizeText(text, CONFIG.MAX_TEXT_LENGTH.facilityName);
    if (flow.data.name.length < 2) {
      return ctx.reply('❌ Facility name must be at least 2 characters. Please try again:');
    }
    flow.step = 2;
    stateManager.setUserFlow(ctx.from.id, flow);
    return ctx.reply('🏙️ Step 2/3: Enter city:');
  }
  
  if (flow.step === 2) {
    flow.data.city = Validator.sanitizeText(text, CONFIG.MAX_TEXT_LENGTH.city);
    if (flow.data.city.length < 2) {
      return ctx.reply('❌ City must be at least 2 characters. Please try again:');
    }
    flow.step = 3;
    stateManager.setUserFlow(ctx.from.id, flow);
    return ctx.reply('📞 Step 3/3: Enter contact phone:');
  }
  
  if (flow.step === 3) {
    flow.data.phone = Validator.sanitizeText(text, CONFIG.MAX_TEXT_LENGTH.phone);
    
    const validationErrors = Validator.validateFacilityData(flow.data);
    if (validationErrors.length > 0) {
      return ctx.reply(`❌ Validation errors:\n• ${validationErrors.join('\n• ')}\n\nPlease enter a valid phone number:`);
    }

    try {
      const user = await DatabaseService.ensureUser(ctx);
      const facility = await DatabaseService.createFacility(flow.data, user.id);
      
      stateManager.clearUserFlow(ctx.from.id);
      
      const successMessage = `✅ **Facility Registration Submitted**

📦 **Details:**
• **Name:** ${facility.name}
• **City:** ${flow.data.city}
• **Phone:** ${flow.data.phone}
• **Plan:** Free
• **Status:** ⏳ Pending approval

Your request has been sent to the administrator for review.`;

      await ctx.replyWithMarkdown(successMessage);

      // Notify master
      if (CONFIG.MASTER_ID) {
        try {
          await bot.telegram.sendMessage(
            CONFIG.MASTER_ID,
            `🔔 **New Facility Registration**\n\n• **Name:** ${facility.name}\n• **City:** ${flow.data.city}\n• **Phone:** ${flow.data.phone}\n• **Facility ID:** ${facility.id}`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('MASTER_NOTIFICATION_ERROR:', error);
        }
      }
    } catch (error) {
      stateManager.clearUserFlow(ctx.from.id);
      await ctx.reply('❌ Registration failed. Please try again later.');
    }
  }
}

// === Join Facility Flow ===
bot.action('start_join', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const facilities = await prisma.facility.findMany({
      where: {
        OR: [
          { isActive: true },
          { isDefault: true }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    if (!facilities.length) {
      return ctx.reply('❌ No facilities available to join. Please register a new facility or contact support.');
    }

    const rows = facilities.map(f => ([{
      text: `🏢 ${f.name}${f.isDefault ? ' • default' : ''}${!f.isActive ? ' (inactive)' : ''}`,
      callback_data: `join_fac_${f.id}`
    }]));

    await ctx.editMessageText(
      '🏢 **Available Facilities**\n\nChoose a facility to join:',
      UIComponents.createInlineKeyboard(rows.concat([[{
        text: '⬅️ Back to Menu',
        callback_data: 'back_main'
      }]]))
    );
  } catch (error) {
    console.error('JOIN_START_ERROR:', error);
    await ctx.reply('❌ Failed to load facilities. Please try again.');
  }
});

// === Work Order Flows ===
bot.action('wo:start_new', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const { user } = await AuthService.requireMembership(ctx);
    stateManager.setUserFlow(ctx.from.id, {
      type: 'work_order_creation',
      step: 1,
      data: {}
    });
    await ctx.reply('🔧 Department? (e.g., civil/electrical/mechanical)');
  } catch (error) {
    console.error('WO_START_NEW_ERROR:', error);
    await ctx.reply('❌ Failed to start new work order. Please try again.');
  }
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const flow = stateManager.getUserFlow(userId);
  
  if (!flow || flow.type !== 'work_order_creation') return;

  try {
    if (flow.step === 1) {
      flow.data.department = Validator.sanitizeText(ctx.message.text.trim(), CONFIG.MAX_TEXT_LENGTH.department);
      if (!flow.data.department) {
        return ctx.reply('❌ Please select a department.');
      }
      flow.step = 2;
      stateManager.setUserFlow(userId, flow);
      return ctx.reply('🔗 Priority? (low/medium/high)');
    }

    if (flow.step === 2) {
      flow.data.priority = Validator.sanitizeText(ctx.message.text.trim(), CONFIG.MAX_TEXT_LENGTH.department);
      if (!flow.data.priority) {
        return ctx.reply('❌ Please select a priority.');
      }
      flow.step = 3;
      stateManager.setUserFlow(userId, flow);
      return ctx.reply('📝 Describe the issue:');
    }

    if (flow.step === 3) {
      flow.data.description = Validator.sanitizeText(ctx.message.text.trim(), CONFIG.MAX_TEXT_LENGTH.description);
      if (!flow.data.description) {
        return ctx.reply('❌ Description cannot be empty.');
      }

      const validationErrors = Validator.validateWorkOrder(flow.data);
      if (validationErrors.length > 0) {
        return ctx.reply(`❌ Validation errors:\n• ${validationErrors.join('\n• ')}\n\nPlease try again:`);
      }

      try {
        const { user } = await AuthService.requireMembership(ctx);
        const wo = await prisma.workOrder.create({
          data: {
            facilityId: user.activeFacilityId,
            createdByUserId: user.id,
            status: 'open',
            department: flow.data.department.toLowerCase(),
            priority: flow.data.priority.toLowerCase(),
            description: flow.data.description
          }
        });

        stateManager.clearUserFlow(userId);
        await ctx.reply(`✅ Request created: #${wo.id.toString()}`);
      } catch (error) {
        stateManager.clearUserFlow(userId);
        await ctx.reply('❌ Failed to create work order. Please try again.');
      }
    }
  } catch (error) {
    console.error('WO_TEXT_HANDLER_ERROR:', error);
    stateManager.clearUserFlow(userId);
    await ctx.reply('❌ An error occurred. Flow cancelled. Please try again.');
  }
});

// === My Issues (pagination + filter) ===
bot.action(/^wo:my\|(\d+)\|(all|Open|In Progress|Closed)$/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10) || 1;
  const filter = ctx.match[2];
  const { user } = await AuthService.requireMembership(ctx);

  const whereBase = { facilityId: user.activeFacilityId, createdByUserId: user.id };
  const where = (filter === 'all') ? whereBase : { ...whereBase, status: filter.toLowerCase().replace(' ', '_') };

  const total = await prisma.workOrder.count({ where });
  if (!total) { return ctx.reply('No matching requests.'); }

  const totalPages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);

  const items = await prisma.workOrder.findMany({
    where, orderBy: { updatedAt: 'desc' }, skip: (current - 1) * CONFIG.PAGE_SIZE, take: CONFIG.PAGE_SIZE
  });

  let msg = `My Issues (page ${current}/${totalPages}, filter: ${filter}):\n`;
  for (const r of items) {
    const st = r.status.toUpperCase();
    const snip = (r.description || '').slice(0, 40);
    msg += `• #${r.id.toString()} — ${st} — ${snip}${r.description?.length > 40 ? '…' : ''}\n`;
  }

  const nav = [];
  if (current > 1) nav.push({ text: '⬅️ Prev', callback_data: `wo:my|${current - 1}|${filter}` });
  if (current < totalPages) nav.push({ text: '➡️ Next', callback_data: `wo:my|${current + 1}|${filter}` });

  const filters = [
    { text: 'All', callback_data: 'wo:my|1|all' },
    { text: 'Open', callback_data: 'wo:my|1|Open' },
    { text: 'In Progress', callback_data: 'wo:my|1|In Progress' },
    { text: 'Closed', callback_data: 'wo:my|1|Closed' },
  ];

  await ctx.reply(msg, { reply_markup: { inline_keyboard: [nav].filter(r => r.length).concat([filters]).concat([[{ text: '⬅️ Back', callback_data: 'back_main' }]]) } });
});

bot.action('back_main', async (ctx) => {
  await ctx.answerCbQuery();
  await UIComponents.sendMainMenu(ctx);
});

// === Manage requests (admin/tech) + status updates + timeline ===
bot.action(/^wo:manage\|(\d+)\|(all|Open|In Progress|Closed)$/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10) || 1;
  const filter = ctx.match[2];
  const { user, member } = await AuthService.requireMembership(ctx);
  // صلاحيات
  if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) return ctx.reply('Not authorized.');

  const whereBase = { facilityId: user.activeFacilityId };
  const where = (filter === 'all') ? whereBase : { ...whereBase, status: filter.toLowerCase().replace(' ', '_') };

  const total = await prisma.workOrder.count({ where });
  if (!total) return ctx.reply('No requests.');

  const totalPages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const items = await prisma.workOrder.findMany({
    where, orderBy: { updatedAt: 'desc' }, skip: (current - 1) * CONFIG.PAGE_SIZE, take: CONFIG.PAGE_SIZE
  });

  let msg = `Requests (page ${current}/${totalPages}, filter: ${filter}):\n`;
  const rows = [];
  for (const r of items) {
    const st = r.status.replace('_', ' ');
    msg += `• #${r.id.toString()} — ${st} — ${(r.description || '').slice(0, 40)}\n`;
    const row = [];
    if (r.status !== 'in_progress') row.push({ text: '🟠 In Progress', callback_data: `wo:status|${r.id}|In Progress` });
    if (r.status !== 'closed') row.push({ text: '🟢 Close', callback_data: `wo:status|${r.id}|Closed` });
    if (r.status !== 'open') row.push({ text: '🔴 Reopen', callback_data: `wo:status|${r.id}|Open` });
    rows.push(row);
  }

  const nav = [];
  if (current > 1) nav.push({ text: '⬅️ Prev', callback_data: `wo:manage|${current - 1}|${filter}` });
  if (current < totalPages) nav.push({ text: '➡️ Next', callback_data: `wo:manage|${current + 1}|${filter}` });

  const filters = [
    { text: 'All', callback_data: 'wo:manage|1|all' },
    { text: 'Open', callback_data: 'wo:manage|1|Open' },
    { text: 'In Progress', callback_data: 'wo:manage|1|In Progress' },
    { text: 'Closed', callback_data: 'wo:manage|1|Closed' }
  ];

  await ctx.reply(msg, { reply_markup: { inline_keyboard: [nav].filter(r => r.length).concat([filters]).concat(rows).concat([[{ text: '⬅️ Back', callback_data: 'back_main' }]]) } });
});

// تحديث حالة + Timeline
bot.action(/^wo:status\|(\d+)\|(Open|In Progress|Closed)$/, async (ctx) => {
  const id = BigInt(ctx.match[1]);
  const newLabel = ctx.match[2]; // human label
  const newStatus = newLabel.toLowerCase().replace(' ', '_'); // prisma enum توقع
  const { user, member } = await AuthService.requireMembership(ctx);
  if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) return ctx.reply('Not authorized.');

  const wo = await prisma.workOrder.findUnique({ where: { id } });
  if (!wo || wo.facilityId !== user.activeFacilityId) return ctx.reply('Not found.');

  const old = wo.status;
  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id }, data: { status: newStatus } });
    await tx.statusHistory.create({ data: { workOrderId: id, oldStatus: old, newStatus: newStatus, updatedByUserId: user.id } });
  });

  return ctx.reply(`✅ WO #${id.toString()} updated: ${old} → ${newStatus}`);
});

// === Master Panel (/master) (NEW) ===
bot.command('master', async (ctx) => {
  try {
    // حراسة صلاحيات الماستر (حسب مشروعك)
    if (String(ctx.from.id) !== String(CONFIG.MASTER_ID)) {
      return ctx.reply('Only master can access this panel.');
    }

    // عدّادات سريعة
    const [pendingFacilities, activeFacilities, totalFacilities] = await Promise.all([
      prisma.facility.count({ where: { isActive: false } }),
      prisma.facility.count({ where: { isActive: true } }),
      prisma.facility.count()
    ]);

    const [pendingJoinRequests] = await Promise.all([
      prisma.facilitySwitchRequest.count({ where: { status: 'pending' } }).catch(() => 0) // لو عندك جدول/منطق آخر للطلبات عدّله هنا
    ]);

    const text =
      '🛠️ Master Panel\n' +
      '—\n' +
      `Pending Facilities: ${pendingFacilities}\n` +
      `Pending Join Requests: ${pendingJoinRequests}\n` +
      `Active Facilities: ${activeFacilities}\n` +
      `Total Facilities: ${totalFacilities}\n\n` +
      'Choose action:';

    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏢 Pending Facilities', callback_data: 'mf_list' }],
          [{ text: '👥 Pending Join Requests', callback_data: 'mj_list' }],
          // (اختياري) زر لعرض كل المنشآت
          [{ text: '📋 List Facilities (active & default)', callback_data: 'mf_list_fac' }]
        ]
      }
    };

    await ctx.reply(text, kb);
  } catch (e) {
    console.error('master panel error', e);
    await ctx.reply('Failed to open master panel.');
  }
});

// === Master Panel Actions ===
// Pending facilities
bot.action('mf_list', async (ctx) => {
  if (!AuthService.isMaster(ctx)) {
    await ctx.answerCbQuery('Not allowed', { show_alert: true });
    return;
  }

  const items = await prisma.facility.findMany({ where: { isActive: false }, take: 10, orderBy: { createdAt: 'asc' } });
  if (!items.length) return ctx.answerCbQuery('No pending facilities', { show_alert: true });
  const lines = items.map(f => `• ${f.id.toString()} — ${f.name}`).join('\n');
  await ctx.editMessageText(
    `🏢 Pending Facilities:\n${lines}\n\nChoose facility to activate with plan:`,
    UIComponents.createInlineKeyboard(items.map(f => ([
      { text: `✅ Free #${f.id.toString()}`,     callback_data: `mf_appr_Free_${f.id.toString()}` },
      { text: `✅ Pro #${f.id.toString()}`,      callback_data: `mf_appr_Pro_${f.id.toString()}` },
      { text: `✅ Business #${f.id.toString()}`, callback_data: `mf_appr_Business_${f.id.toString()}` },
    ])))
  );
});

// Approve facility
bot.action(/^mf_appr_(Free|Pro|Business)_(\d+)$/, async (ctx) => {
  if (!AuthService.isMaster(ctx)) {
    await ctx.answerCbQuery('Not allowed', { show_alert: true });
    return;
  }
  const plan = ctx.match[1];
  const fidStr = ctx.match[2];
  const facilityId = BigInt(fidStr);
  await prisma.facility.update({ where: { id: facilityId }, data: { isActive: true, planTier: plan } });
  await ctx.answerCbQuery('Facility activated ✅');
  return ctx.editMessageText(`✅ Facility #${fidStr} activated with plan: ${plan}`);
});

// Pending join requests
bot.action('mj_list', async (ctx) => {
  if (!AuthService.isMaster(ctx)) {
    await ctx.answerCbQuery('Not allowed', { show_alert: true });
    return;
  }
  const reqs = await prisma.facilitySwitchRequest.findMany({
    where: { status: 'pending' }, take: 10, orderBy: { createdAt: 'asc' }
  });
  if (!reqs.length) return ctx.answerCbQuery('No pending requests', { show_alert: true });
  const lines = await Promise.all(reqs.map(async r => {
    const u = await prisma.user.findUnique({ where: { id: r.userId } });
    const f = r.toFacilityId ? await prisma.facility.findUnique({ where: { id: r.toFacilityId } }) : null;
    return `• req#${r.id.toString()} — tg:${u?.tgId?.toString() ?? '?'} → ${f?.name ?? '?'}`
  }));
  await ctx.editMessageText(
    `👥 Pending Join Requests:\n${lines.join('\n')}\n\nChoose action:`,
    UIComponents.createInlineKeyboard(reqs.map(r => ([
      { text: `✅ Approve #${r.id.toString()}`, callback_data: `mj_appr_${r.id.toString()}` },
      { text: `⛔ Deny #${r.id.toString()}`,    callback_data: `mj_den_${r.id.toString()}` },
    ])))
  );
});
// Approve join request
bot.action(/^mj_appr_(\d+)$/, async (ctx) => {
  if (!AuthService.isMaster(ctx)) {
    await ctx.answerCbQuery('Not allowed', { show_alert: true });
    return;
  }
  const rid = BigInt(ctx.match[1]);
  const req = await prisma.facilitySwitchRequest.findUnique({ where: { id: rid } });
  if (!req) return ctx.answerCbQuery('Not found', { show_alert: true });
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return ctx.answerCbQuery('User missing', { show_alert: true });
  const role = user.requestedRole || 'user';
  await prisma.facilityMember.upsert({
    where: { userId_facilityId: { userId: user.id, facilityId: req.toFacilityId } },
    create: { userId: user.id, facilityId: req.toFacilityId, role },
    update: { role }
  });
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active', activeFacilityId: req.toFacilityId } });
  await prisma.facilitySwitchRequest.update({ where: { id: req.id }, data: { status: 'approved' } });
  if (user.tgId) { 
    bot.telegram.sendMessage(user.tgId.toString(), `✅ Your join request has been approved.`).catch(()=>{});
  }
  await ctx.answerCbQuery('Approved ✅');
  return ctx.editMessageText(`✅ Approved req #${rid.toString()}`);
});

// Deny join request
bot.action(/^mj_den_(\d+)$/, async (ctx) => {
  if (!AuthService.isMaster(ctx)) {
    await ctx.answerCbQuery('Not allowed', { show_alert: true });
    return;
  }
  const rid = BigInt(ctx.match[1]);
  const req = await prisma.facilitySwitchRequest.findUnique({ where: { id: rid } });
  if (!req) return ctx.answerCbQuery('Not found', { show_alert: true });
  await prisma.facilitySwitchRequest.update({ where: { id: rid }, data: { status: 'rejected' } });
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (user?.tgId) { 
    bot.telegram.sendMessage(user.tgId.toString(), `⛔ Your join request has been denied.`).catch(()=>{});
  }
  await ctx.answerCbQuery('Denied');
  return ctx.editMessageText(`⛔ Denied req #${rid.toString()}`);
});

// List facilities for master (active OR default)
bot.action('mf_list_fac', async (ctx) => {
  if (!AuthService.isMaster(ctx)) {
    await ctx.answerCbQuery('Not allowed', { show_alert: true });
    return;
  }
  try {
    const facs = await prisma.facility.findMany({
      where: { OR: [{ isActive: true }, { isDefault: true }] },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take: 100
    });

    if (!facs.length) {
      await ctx.reply('No facilities (active/default) found.');
      return;
    }

    const lines = facs.map(f =>
      `• ${f.name}  — ${f.isActive ? 'active' : 'inactive'}${f.isDefault ? ' • default' : ''}`
    );
    await ctx.reply(lines.join('\n'));
  } catch (e) {
    console.error('MF_LIST_FAC_ERR', e);
    await ctx.reply('Failed to list facilities.');
  }
});

    // ===== Webhook bootstrap (single-set) + robust handler =====
  const WEBHOOK_PATH = CONFIG.WEBHOOK_PATH; // '/api/telegram'
  const WEBHOOK_URL  = `${CONFIG.PUBLIC_URL}${WEBHOOK_PATH}`;
  const WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET || ''; // اختياري

  // جهة واحدة بس تضبط الويبهوك (وقت البارد ستارت)
  let _webhookReady = false;

  async function ensureWebhook(bot) {
    if (_webhookReady) return;
    try {
      const info = await bot.telegram.getWebhookInfo();
      const sameUrl = info?.url === WEBHOOK_URL;
      const needSet =
        !sameUrl ||
        !(info.allowed_updates || []).includes('callback_query') ||
        (WEBHOOK_SECRET && info.secret_token !== WEBHOOK_SECRET);

      if (needSet) {
        await bot.telegram.setWebhook(WEBHOOK_URL, {
          drop_pending_updates: false,
          allowed_updates: CONFIG.ALLOWED_UPDATES,
          secret_token: WEBHOOK_SECRET || undefined,
          max_connections: 40
        });
        console.log('WEBHOOK_SET_OK', { url: WEBHOOK_URL });
      } else {
        console.log('WEBHOOK_ALREADY_OK', { url: WEBHOOK_URL });
      }
      _webhookReady = true;
    } catch (e) {
      console.error('SET_WEBHOOK_ERR', e?.message || e);
    }
  }

  // لوج شامل للتحديثات قبل أي هاندلر
  bot.use(async (ctx, next) => {
    try {
      const u = ctx.update || {};
      if (u.callback_query) {
        console.log('UPD_CALLBACK', {
          from: ctx.from?.id, data: u.callback_query?.data, mid: u.callback_query?.message?.message_id
        });
        // نجاوب بسرعة عشان نمنع "Loading…"
        await ctx.answerCbQuery().catch(()=>{});
      } else if (u.message) {
        const t = u.message.text || u.message.data || Object.keys(u.message);
        console.log('UPD_MESSAGE', { from: ctx.from?.id, text: t });
      } else {
        console.log('UPD_OTHER', Object.keys(u));
      }
    } catch (_) {}
    return next();
  });

  // Handler: يدعم raw body لو req.body مش موجود
  const handle = bot.webhookCallback(WEBHOOK_PATH, {
    secretToken: WEBHOOK_SECRET || undefined
  });

  module.exports = async (req, res) => {
    // Health for GET
    if (req.method !== 'POST') {
      res.statusCode = 200;
      return res.end('OK');
    }

    // تأكد إن الويبهوك مضبوط (مرة واحدة)
    await ensureWebhook(bot);

    // Vercel أحيانًا مايبعّتش body جاهز → نقرأه يدويًا
    if (!req.body || Object.keys(req.body).length === 0) {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw) req.body = JSON.parse(raw);
      } catch (e) {
        console.error('RAW_BODY_PARSE_ERR', e?.message || e);
        // نرجّع 200 عشان تيليجرام ما تعيدش بلا نهاية
        res.statusCode = 200;
        return res.end('OK');
      }
    }

    try {
      // مرر للتلغراف
      return handle(req, res);
    } catch (e) {
      console.error('WEBHOOK_HANDLE_ERR', e?.message || e);
      res.statusCode = 200;
      return res.end('OK');
    }
  };

  module.exports.config = { runtime: 'nodejs20' };
}

