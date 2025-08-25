// api/telegram/index.js
// FixFlowBot — English-only UX, stable flows, no stuck buttons.

const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

// ===== Config =====
const CONFIG = {
  TOKEN: process.env.BOT_TOKEN,
  PUBLIC_URL: process.env.PUBLIC_URL,
  MASTER_ID: String(process.env.MASTER_ID || ''),
  WEBHOOK_PATH: '/api/telegram',
  ALLOWED_UPDATES: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
  HANDLER_TIMEOUT: 9000,
  RATE_1S: 1000,
  FLOW_TTL_MS: 10 * 60 * 1000,
  PAGE_SIZE: 5,
  TXT_LIMITS: { facilityName: 60, city: 40, phone: 25, desc: 500, dept: 50 }
};

// Fail fast if missing vars
if (!CONFIG.TOKEN || !CONFIG.PUBLIC_URL) {
  console.error('Missing BOT_TOKEN or PUBLIC_URL');
  module.exports = (req, res) => { res.statusCode = 500; res.end('Misconfigured bot'); };
  module.exports.config = { runtime: 'nodejs20' };
  return;
}

// ===== Prisma (singleton) =====
const prisma = (() => {
  if (globalThis._prisma) return globalThis._prisma;
  globalThis._prisma = new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'] });
  return globalThis._prisma;
})();

// ===== Lightweight state (singleton) =====
const store = (() => {
  if (globalThis._ff_store) return globalThis._ff_store;
  globalThis._ff_store = {
    flows: new Map(),       // userId -> {type, step, data, ts}
    cooldowns: new Map(),   // key -> epochMS
    webhookReady: false,
    commandsSet: false
  };
  return globalThis._ff_store;
})();

const now = () => Date.now();
const setCooldown = (k, d) => store.cooldowns.set(k, now() + d);
const inCooldown = (k) => {
  const t = store.cooldowns.get(k);
  if (!t) return false;
  if (now() > t) { store.cooldowns.delete(k); return false; }
  return true;
};
const setFlow = (uid, f) => store.flows.set(uid, { ...f, ts: now() });
const getFlow = (uid) => {
  const f = store.flows.get(uid);
  if (!f) return null;
  if (now() - f.ts > CONFIG.FLOW_TTL_MS) { store.flows.delete(uid); return null; }
  return f;
};
const clearFlow = (uid) => store.flows.delete(uid);

// ===== Helpers =====
const sanitize = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

async function ensureUser(ctx) {
  const tgId = BigInt(ctx.from.id);
  let u = await prisma.user.findUnique({ where: { tgId } });
  if (!u) {
    u = await prisma.user.create({
      data: { tgId, firstName: sanitize(ctx.from.first_name, 50), status: 'pending' }
    });
  }
  return u;
}

async function requireMembership(ctx) {
  const user = await ensureUser(ctx);
  if (!user.activeFacilityId) throw new Error('no_active_facility');
  const member = await prisma.facilityMember.findFirst({
    where: { userId: user.id, facilityId: user.activeFacilityId }
  });
  if (!member) throw new Error('no_membership');
  return { user, member };
}

function roleAllowed(member, ...roles) {
  return !!(member && roles.includes(member.role));
}

// ===== Bot =====
const bot = new Telegraf(CONFIG.TOKEN, { handlerTimeout: CONFIG.HANDLER_TIMEOUT });

// Global error handler
bot.catch(async (err, ctx) => {
  console.error('TELEGRAM_ERROR', { err: err.stack || err.message, type: ctx?.updateType, user: ctx?.from?.id });
  try { await ctx.answerCbQuery('An error occurred. Please try again.').catch(() => {}); } catch {}
});

// Rate-limit + request log
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (uid && inCooldown(`rate:${uid}`)) return;
  if (uid) setCooldown(`rate:${uid}`, CONFIG.RATE_1S);
  // Minimal log
  console.log('UPDATE', { type: ctx.updateType, uid, text: ctx.message?.text?.slice(0, 64) });
  return next();
});

// One-time commands visible in Telegram UI
async function ensureCommands() {
  if (store.commandsSet) return;
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Open main menu' },
    { command: 'help',  description: 'Show help' },
    { command: 'me',    description: 'My profile' },
    { command: 'ping',  description: 'Health check' },
    { command: 'menu',  description: 'Open main menu' }
  ]).catch(console.error);
  store.commandsSet = true;
}

// ===== UI =====
async function mainMenu(ctx) {
  const me = await ensureUser(ctx);
  const rows = [];
  if (me.status !== 'active' || !me.activeFacilityId) {
    rows.push([
      Markup.button.callback('🆕 Register Facility', 'start_reg_fac'),
      Markup.button.callback('👥 Join Facility', 'start_join')
    ]);
  } else {
    const member = await prisma.facilityMember.findFirst({
      where: { userId: me.id, facilityId: me.activeFacilityId }
    });
    rows.push([
      Markup.button.callback('➕ New Issue', 'wo:start_new'),
      Markup.button.callback('📋 My Issues', 'wo:my|1|all')
    ]);
    if (roleAllowed(member, 'facility_admin', 'supervisor', 'technician')) {
      rows.push([Markup.button.callback('🔧 Manage Requests', 'wo:manage|1|all')]);
    }
  }
  rows.push([Markup.button.callback('ℹ️ Help', 'help')]);
  return ctx.reply('Choose an action:', Markup.inlineKeyboard(rows));
}

async function onboardingMenu(ctx) {
  return ctx.reply(
    'Welcome to FixFlow! Choose how to start:',
    Markup.inlineKeyboard([
      [Markup.button.callback('🆕 Register Facility', 'start_reg_fac')],
      [Markup.button.callback('👥 Join Facility', 'start_join')],
      [Markup.button.callback('ℹ️ Help', 'help')]
    ])
  );
}

// Smart welcome (no spam)
bot.use(async (ctx, next) => {
  // skip for commands / callbacks / bot messages
  if (ctx.updateType === 'callback_query') return next();
  if (ctx.message?.text?.startsWith('/')) return next();
  if (ctx.message?.from?.is_bot) return;

  // if in a flow, pass through
  if (getFlow(ctx.from.id)) return next();

  try {
    const user = await ensureUser(ctx);
    if (user.status !== 'active' || !user.activeFacilityId) {
      const key = `welcome:${ctx.chat.id}`;
      if (!inCooldown(key)) {
        setCooldown(key, 60_000);
        await onboardingMenu(ctx);
      }
    }
  } catch (e) {
    // ignore
  }
  return next();
});

// ===== Commands =====
bot.command('ping', (ctx) => ctx.reply('pong ✅'));

bot.command(['start', 'menu'], async (ctx) => {
  try { await mainMenu(ctx); } catch { ctx.reply('Failed to open menu. Try again.'); }
});

bot.command('help', async (ctx) => {
  const txt =
`🆘 FixFlow Help

Commands:
• /start — open main menu
• /me — profile & current facility
• /ping — health check
• /help — this message

Getting started:
1) Register a facility or Join an existing one
2) Create issues and track their status
3) Use Manage to update statuses (admins/tech)

Roles: user, technician, supervisor, facility_admin`;
  return ctx.reply(txt);
});

bot.command('me', async (ctx) => {
  try {
    const user = await ensureUser(ctx);
    const fac = user.activeFacilityId ? await prisma.facility.findUnique({ where: { id: user.activeFacilityId } }) : null;
    const mem = user.activeFacilityId
      ? await prisma.facilityMember.findFirst({ where: { userId: user.id, facilityId: user.activeFacilityId } })
      : null;

    const lines = [
      '👤 Profile',
      `ID: ${user.id.toString()}`,
      `Telegram: ${ctx.from.id}`,
      `Status: ${user.status}`,
      `Active facility: ${fac?.name || '—'}`,
      `Role: ${mem?.role || '—'}`,
      user.requestedRole ? `Requested role: ${user.requestedRole}` : null
    ].filter(Boolean);
    return ctx.reply(lines.join('\n'));
  } catch {
    return ctx.reply('Could not load your profile.');
  }
});

// Help button
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await bot.handleUpdate({ ...ctx.update, message: { ...ctx.update.callback_query.message, text: '/help' } });
});

// Back button
bot.action('back_main', async (ctx) => { await ctx.answerCbQuery().catch(()=>{}); return mainMenu(ctx); });

// ===== Facility Registration Flow =====
bot.action('start_reg_fac', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  setFlow(ctx.from.id, { type: 'reg_fac', step: 1, data: {} });
  try {
    await ctx.editMessageText('Facility Registration\n\nStep 1/3: Enter facility name:');
  } catch {
    await ctx.reply('Facility Registration\n\nStep 1/3: Enter facility name:');
  }
});

bot.on('text', async (ctx, next) => {
  const flow = getFlow(ctx.from.id);
  if (!flow) return next();

  const t = ctx.message.text?.trim() || '';

  // Registration flow
  if (flow.type === 'reg_fac') {
    if (flow.step === 1) {
      flow.data.name = sanitize(t, CONFIG.TXT_LIMITS.facilityName);
      if (flow.data.name.length < 2) return ctx.reply('Name too short. Enter facility name:');
      flow.step = 2; setFlow(ctx.from.id, flow);
      return ctx.reply('Step 2/3: Enter city:');
    }
    if (flow.step === 2) {
      flow.data.city = sanitize(t, CONFIG.TXT_LIMITS.city);
      if (flow.data.city.length < 2) return ctx.reply('City too short. Enter city:');
      flow.step = 3; setFlow(ctx.from.id, flow);
      return ctx.reply('Step 3/3: Enter contact phone:');
    }
    if (flow.step === 3) {
      flow.data.phone = sanitize(t, CONFIG.TXT_LIMITS.phone);
      if (!/^[\d\s+\-()]{7,}$/.test(flow.data.phone)) return ctx.reply('Invalid phone. Enter contact phone:');
      try {
        const user = await ensureUser(ctx);
        const result = await prisma.$transaction(async (tx) => {
          const facility = await tx.facility.create({
            data: { name: flow.data.name, isDefault: false, isActive: false, planTier: 'Free' }
          });
          await tx.facilityMember.create({
            data: { userId: user.id, facilityId: facility.id, role: 'facility_admin' }
          });
          await tx.user.update({
            where: { id: user.id },
            data: { activeFacilityId: facility.id, requestedRole: 'facility_admin' }
          });
          return facility;
        });

        clearFlow(ctx.from.id);
        await ctx.reply(
`✅ Facility registration submitted

Name: ${result.name}
City: ${flow.data.city}
Phone: ${flow.data.phone}
Plan: Free
Status: pending approval`
        );

        if (CONFIG.MASTER_ID) {
          try {
            await bot.telegram.sendMessage(
              CONFIG.MASTER_ID,
              `New facility request:\n• ${result.name}\n• City: ${flow.data.city}\n• Phone: ${flow.data.phone}`
            );
          } catch {}
        }
      } catch (e) {
        console.error('REG_FLOW_ERR', e.message);
        clearFlow(ctx.from.id);
        return ctx.reply('Registration failed. Please try again later.');
      }
    }
    return;
  }

  // New WO flow
  if (flow.type === 'new_wo') {
    try {
      if (flow.step === 1) {
        flow.data.department = sanitize(t, CONFIG.TXT_LIMITS.dept).toLowerCase();
        flow.step = 2; setFlow(ctx.from.id, flow);
        return ctx.reply('Priority? (low / medium / high)');
      }
      if (flow.step === 2) {
        flow.data.priority = sanitize(t, 10).toLowerCase();
        if (!['low','medium','high'].includes(flow.data.priority)) return ctx.reply('Invalid priority. Use: low / medium / high');
        flow.step = 3; setFlow(ctx.from.id, flow);
        return ctx.reply('Describe the issue:');
      }
      if (flow.step === 3) {
        flow.data.description = sanitize(t, CONFIG.TXT_LIMITS.desc);
        const { user } = await requireMembership(ctx);
        const wo = await prisma.workOrder.create({
          data: {
            facilityId: user.activeFacilityId,
            createdByUserId: user.id,
            status: 'open',
            department: flow.data.department,
            priority: flow.data.priority,
            description: flow.data.description
          }
        });
        clearFlow(ctx.from.id);
        return ctx.reply(`✅ Request created: #${wo.id.toString()}`);
      }
    } catch (e) {
      console.error('NEW_WO_ERR', e.message);
      clearFlow(ctx.from.id);
      return ctx.reply('Failed to create request. Try again.');
    }
  }
});

// ===== Join Facility Flow =====
bot.action('start_join', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  try {
    const facs = await prisma.facility.findMany({
      where: { OR: [{ isActive: true }, { isDefault: true }] },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    if (!facs.length) return ctx.reply('No facilities available to join yet.');

    const rows = facs.map(f => ([
      { text: `🏢 ${f.name}${f.isDefault ? ' • default' : ''}${!f.isActive ? ' (inactive)' : ''}`, callback_data: `join_fac_${f.id.toString()}` }
    ]));
    try {
      await ctx.editMessageText('Choose a facility to join:', { reply_markup: { inline_keyboard: rows.concat([[{ text: '⬅️ Back', callback_data: 'back_main' }]]) } });
    } catch {
      await ctx.reply('Choose a facility to join:', { reply_markup: { inline_keyboard: rows.concat([[{ text: '⬅️ Back', callback_data: 'back_main' }]]) } });
    }
  } catch (e) {
    console.error('JOIN_START_ERR', e.message);
    return ctx.reply('Failed to load facilities. Try again.');
  }
});

bot.action(/join_fac_(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  try {
    const facilityId = BigInt(ctx.match[1]);
    const f = await prisma.facility.findUnique({ where: { id: facilityId } });
    if (!f || !f.isActive) return ctx.answerCbQuery('Facility not available now', { show_alert: true });
    setFlow(ctx.from.id, { type: 'join', step: 2, facilityId });
    const rows = [[
      { text: '👤 User', callback_data: 'role_user' },
      { text: '🛠 Technician', callback_data: 'role_technician' },
      { text: '🧭 Supervisor', callback_data: 'role_supervisor' }
    ]];
    return ctx.editMessageText(`Choose your role to join: ${f.name}`, { reply_markup: { inline_keyboard: rows } });
  } catch (e) {
    console.error('JOIN_PICK_ERR', e.message);
    return ctx.answerCbQuery('Error selecting facility', { show_alert: true });
  }
});

bot.action(/role_(user|technician|supervisor)/, async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  const flow = getFlow(ctx.from.id);
  if (!flow || flow.type !== 'join' || flow.step !== 2) {
    return ctx.answerCbQuery('Session expired. Use /start', { show_alert: true });
  }
  const role = ctx.match[1];
  try {
    const tgId = BigInt(ctx.from.id);
    let user = await prisma.user.findUnique({ where: { tgId } });
    if (!user) {
      user = await prisma.user.create({ data: { tgId, firstName: sanitize(ctx.from.first_name, 50), status: 'pending' } });
    }
    await prisma.user.update({ where: { id: user.id }, data: { requestedRole: role } });
    const req = await prisma.facilitySwitchRequest.create({
      data: { userId: user.id, fromFacilityId: user.activeFacilityId ?? null, toFacilityId: flow.facilityId, status: 'pending' }
    });
    clearFlow(ctx.from.id);

    const f = await prisma.facility.findUnique({ where: { id: flow.facilityId } });
    await ctx.editMessageText(
`Join request submitted

Facility: ${f?.name || flow.facilityId.toString()}
Role: ${role}
Status: pending approval`
    );

    if (CONFIG.MASTER_ID) {
      try {
        await bot.telegram.sendMessage(CONFIG.MASTER_ID, `Join request: tg:${tgId.toString()} → ${f?.name || flow.facilityId.toString()} • role: ${role} • req#${req.id.toString()}`);
      } catch {}
    }
  } catch (e) {
    console.error('JOIN_CREATE_ERR', e.message);
    clearFlow(ctx.from.id);
    return ctx.answerCbQuery('Error creating request', { show_alert: true });
  }
});

// ===== My Issues (user) =====
bot.action(/^wo:my\|(\d+)\|(all|Open|In Progress|Closed)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  let page = Number(ctx.match[1]) || 1;
  const filter = ctx.match[2];
  try {
    const { user } = await requireMembership(ctx);
    const whereBase = { facilityId: user.activeFacilityId, createdByUserId: user.id };
    const where = (filter === 'all') ? whereBase : { ...whereBase, status: filter.toLowerCase().replace(' ', '_') };
    const total = await prisma.workOrder.count({ where });
    if (!total) return ctx.reply('No matching requests.');
    const totalPages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
    page = Math.min(Math.max(1, page), totalPages);

    const items = await prisma.workOrder.findMany({
      where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * CONFIG.PAGE_SIZE, take: CONFIG.PAGE_SIZE
    });

    let msg = `My Issues (page ${page}/${totalPages}, filter: ${filter}):\n`;
    for (const r of items) {
      const st = r.status.toUpperCase();
      const snip = (r.description || '').slice(0, 40);
      msg += `• #${r.id.toString()} — ${st} — ${snip}${r.description?.length > 40 ? '…' : ''}\n`;
    }

    const nav = [];
    if (page > 1) nav.push({ text: '⬅️ Prev', callback_data: `wo:my|${page - 1}|${filter}` });
    if (page < totalPages) nav.push({ text: '➡️ Next', callback_data: `wo:my|${page + 1}|${filter}` });
    const filters = [
      { text: 'All', callback_data: 'wo:my|1|all' },
      { text: 'Open', callback_data: 'wo:my|1|Open' },
      { text: 'In Progress', callback_data: 'wo:my|1|In Progress' },
      { text: 'Closed', callback_data: 'wo:my|1|Closed' }
    ];
    return ctx.reply(msg, { reply_markup: { inline_keyboard: [nav].filter(r=>r.length).concat([filters]).concat([[{ text: '⬅️ Back', callback_data: 'back_main' }]]) } });
  } catch (e) {
    console.error('MY_ISSUES_ERR', e.message);
    return ctx.reply('Failed to load your issues.');
  }
});

// ===== New Issue (3-step) =====
bot.action('wo:start_new', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  try {
    await requireMembership(ctx);
    setFlow(ctx.from.id, { type: 'new_wo', step: 1, data: {} });
    return ctx.reply('Department? (e.g., civil / electrical / mechanical / general)');
  } catch {
    return ctx.reply('You need to join a facility first. Use /start.');
  }
});

// ===== Manage Requests (admin/tech) =====
bot.action(/^wo:manage\|(\d+)\|(all|Open|In Progress|Closed)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  let page = Number(ctx.match[1]) || 1;
  const filter = ctx.match[2];
  try {
    const { user, member } = await requireMembership(ctx);
    if (!roleAllowed(member, 'facility_admin', 'supervisor', 'technician')) return ctx.reply('Not authorized.');

    const whereBase = { facilityId: user.activeFacilityId };
    const where = (filter === 'all') ? whereBase : { ...whereBase, status: filter.toLowerCase().replace(' ', '_') };

    const total = await prisma.workOrder.count({ where });
    if (!total) return ctx.reply('No requests.');
    const totalPages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
    page = Math.min(Math.max(1, page), totalPages);

    const items = await prisma.workOrder.findMany({
      where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * CONFIG.PAGE_SIZE, take: CONFIG.PAGE_SIZE
    });

    let msg = `Requests (page ${page}/${totalPages}, filter: ${filter}):\n`;
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
    if (page > 1) nav.push({ text: '⬅️ Prev', callback_data: `wo:manage|${page - 1}|${filter}` });
    if (page < totalPages) nav.push({ text: '➡️ Next', callback_data: `wo:manage|${page + 1}|${filter}` });

    const filters = [
      { text: 'All', callback_data: 'wo:manage|1|all' },
      { text: 'Open', callback_data: 'wo:manage|1|Open' },
      { text: 'In Progress', callback_data: 'wo:manage|1|In Progress' },
      { text: 'Closed', callback_data: 'wo:manage|1|Closed' }
    ];

    return ctx.reply(msg, { reply_markup: { inline_keyboard: [nav].filter(r=>r.length).concat([filters]).concat(rows).concat([[{ text: '⬅️ Back', callback_data: 'back_main' }]]) } });
  } catch (e) {
    console.error('MANAGE_ERR', e.message);
    return ctx.reply('Failed to load requests.');
  }
});

// Update status + timeline
bot.action(/^wo:status\|(\d+)\|(Open|In Progress|Closed)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  try {
    const id = BigInt(ctx.match[1]);
    const newLabel = ctx.match[2];
    const newStatus = newLabel.toLowerCase().replace(' ', '_');
    const { user, member } = await requireMembership(ctx);
    if (!roleAllowed(member, 'facility_admin', 'supervisor', 'technician')) return ctx.reply('Not authorized.');

    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo || wo.facilityId !== user.activeFacilityId) return ctx.reply('Not found.');

    const old = wo.status;
    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({ where: { id }, data: { status: newStatus } });
      await tx.statusHistory.create({ data: { workOrderId: id, oldStatus: old, newStatus, updatedByUserId: user.id } });
    });
    return ctx.reply(`✅ WO #${id.toString()} updated: ${old} → ${newStatus}`);
  } catch (e) {
    console.error('STATUS_ERR', e.message);
    return ctx.reply('Failed to update status.');
  }
});

// ===== Webhook binding =====
const webhookHandler = bot.webhookCallback(CONFIG.WEBHOOK_PATH);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    await ensureCommands().catch(()=>{});
    res.statusCode = 200;
    return res.end('FixFlowBot OK');
  }

  try {
    if (!store.webhookReady) {
      const url = `${CONFIG.PUBLIC_URL}${CONFIG.WEBHOOK_PATH}`;
      bot.telegram.setWebhook(url, { allowed_updates: CONFIG.ALLOWED_UPDATES, drop_pending_updates: false })
        .then(() => console.log('Webhook set:', url))
        .catch((e) => console.error('Webhook error:', e));
      store.webhookReady = true;
      await ensureCommands().catch(()=>{});
    }
    return await webhookHandler(req, res);
  } catch (e) {
    console.error('WEBHOOK_HANDLER_ERR', e);
    res.statusCode = 200; // prevent retries storm
    return res.end('OK');
  }
};

module.exports.config = { runtime: 'nodejs20' };

