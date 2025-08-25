// api/telegram/index.js
// FixFlowBot — EN-only UX, Master preserved, stable callbacks, anti-spam onboarding

const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

// === Config ===
const CONFIG = {
  TOKEN: process.env.BOT_TOKEN,
  PUBLIC_URL: process.env.PUBLIC_URL,
  MASTER_ID: String(process.env.MASTER_ID || ''),
  WEBHOOK_PATH: '/api/telegram',
  ALLOWED_UPDATES: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
  HANDLER_TIMEOUT: 9000,
  PAGE_SIZE: 5,
  ONBOARD_COOLDOWN_MS: 5 * 60 * 1000, // at most once per 5 mins per chat
  RATE_LIMIT_MS: 800, // soft per-user rate limit
};

if (!CONFIG.TOKEN || !CONFIG.PUBLIC_URL) {
  console.error('Missing BOT_TOKEN or PUBLIC_URL');
  module.exports = (req, res) => {
    res.statusCode = 500;
    res.end('Server configuration error');
  };
  module.exports.config = { runtime: 'nodejs20' };
  return;
}

// === Singletons on Vercel instance ===
const g = globalThis;
const prisma = g._prisma ?? new PrismaClient({ log: ['error'] });
if (!g._prisma) g._prisma = prisma;

const flows = g._flows ?? new Map(); // userId -> { flow, step, data, ts }
if (!g._flows) g._flows = flows;

const seen = g._seen ?? new Map();   // userId -> lastTs (rate limit)
if (!g._seen) g._seen = seen;

const onboardMarks = g._onboardMarks ?? new Map(); // chatId -> ts
if (!g._onboardMarks) g._onboardMarks = onboardMarks;

// === Helpers ===
const isMaster = (ctx) => String(ctx.from?.id || '') === CONFIG.MASTER_ID;
const kb = (rows) => ({ reply_markup: { inline_keyboard: rows } });

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

async function requireMembership(ctx) {
  const user = await ensureUser(ctx);
  if (!user.activeFacilityId) throw new Error('no_active_facility');
  const member = await prisma.facilityMember.findFirst({
    where: { userId: user.id, facilityId: user.activeFacilityId }
  });
  if (!member) throw new Error('no_membership');
  return { user, member };
}

function rlOk(userId) {
  const now = Date.now();
  const last = seen.get(userId);
  if (last && now - last < CONFIG.RATE_LIMIT_MS) return false;
  seen.set(userId, now);
  return true;
}

async function showMainMenu(ctx) {
  const me = await ensureUser(ctx);
  const inline = [];
  if (me.status !== 'active' || !me.activeFacilityId) {
    inline.push([Markup.button.callback('🆕 Register Facility', 'start_reg_fac')]);
    inline.push([Markup.button.callback('👥 Join Facility', 'start_join')]);
  } else {
    inline.push([
      Markup.button.callback('➕ New Issue', 'wo:start_new'),
      Markup.button.callback('📋 My Issues', 'wo:my|1|all')
    ]);
    const member = await prisma.facilityMember.findFirst({ where: { userId: me.id, facilityId: me.activeFacilityId } });
    const canManage = member && ['facility_admin','supervisor','technician'].includes(member.role);
    if (canManage) inline.push([Markup.button.callback('🔧 Manage Requests', 'wo:manage|1|all')]);
  }
  inline.push([Markup.button.callback('ℹ️ Help', 'help')]);
  return ctx.reply('Choose an action:', kb(inline));
}

async function sendOnboardingMenu(ctx) {
  return ctx.reply(
    'Welcome to FixFlow! Get started:',
    kb([
      [Markup.button.callback('🆕 Register Facility', 'start_reg_fac')],
      [Markup.button.callback('👥 Join Facility', 'start_join')],
      [Markup.button.callback('ℹ️ Help', 'help')],
    ])
  );
}

// === Bot init ===
const bot = new Telegraf(CONFIG.TOKEN, { handlerTimeout: CONFIG.HANDLER_TIMEOUT });

bot.catch((err, ctx) => {
  console.error('TELEGRAM_ERROR', { err: err.stack || err.message, from: ctx?.from?.id, type: ctx?.updateType });
  try { if (ctx?.answerCbQuery) ctx.answerCbQuery('An error occurred. Try again.').catch(()=>{}); } catch {}
});

// Register commands (EN only, one-time)
if (!g._commandsSet) {
  g._commandsSet = true;
  bot.telegram.setMyCommands([
    { command: 'start',  description: 'Open main menu' },
    { command: 'menu',   description: 'Show main menu' },
    { command: 'help',   description: 'How to use FixFlow' },
    { command: 'me',     description: 'Show my profile' },
    { command: 'ping',   description: 'Check bot status' },
    { command: 'master', description: 'Master panel (owner only)' },
  ]).catch(()=>{});
}

// === Middleware: light onboarding (EN-only) + simple rate limit ===
bot.use(async (ctx, next) => {
  try {
    const uid = ctx.from?.id;
    if (uid && !rlOk(uid)) return; // soft rate-limit

    // Only for plain messages, not commands or callbacks
    if (ctx.updateType !== 'callback_query' && !ctx.message?.text?.startsWith('/')) {
      const chatId = ctx.chat?.id;
      if (chatId) {
        const mark = onboardMarks.get(chatId) || 0;
        const now = Date.now();
        const shouldSend = now - mark > CONFIG.ONBOARD_COOLDOWN_MS;
        const user = await ensureUser(ctx);

        if (shouldSend && (user.status !== 'active' || !user.activeFacilityId)) {
          onboardMarks.set(chatId, now);
          await sendOnboardingMenu(ctx);
        }
      }
    }
  } catch (e) {
    console.error('MIDDLEWARE_ERR', e.message);
  }
  return next();
});

// === Commands ===
bot.command('ping', (ctx) => ctx.reply('Bot is alive ✅'));

bot.command(['start','menu'], async (ctx) => {
  try { await showMainMenu(ctx); }
  catch { await ctx.reply('Failed to open menu. Try /start again.'); }
});

bot.command('help', (ctx) => {
  const text =
`🆘 FixFlow Help

• /start — Main menu
• /me — Your profile & facility
• /ping — Bot status
• /help — This help

Getting started:
1) Register a facility (owner) or Join an active facility
2) Create maintenance requests
3) Track & manage issues (admins/techs)

Need access? Ask your facility admin.`;
  ctx.reply(text);
});

bot.command('me', async (ctx) => {
  try {
    const user = await ensureUser(ctx);
    const active = user.activeFacilityId
      ? await prisma.facility.findUnique({ where: { id: user.activeFacilityId } })
      : null;
    const member = active
      ? await prisma.facilityMember.findFirst({ where: { userId: user.id, facilityId: active.id } })
      : null;

    const lines = [
      '👤 Your Profile',
      `ID: ${user.id.toString()}`,
      `Telegram: ${ctx.from.id}`,
      `Status: ${user.status}`,
      `Active facility: ${active ? active.name : '—'}`,
      `Role: ${member?.role || '—'}`,
      user.requestedRole ? `Requested Role: ${user.requestedRole}` : null
    ].filter(Boolean).join('\n');

    await ctx.reply(lines);
  } catch {
    await ctx.reply('Failed to get profile.');
  }
});

// === Callback: Help button pipes to /help neatly ===
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  bot.handleUpdate({ ...ctx.update, message: { ...ctx.update.callback_query.message, text: '/help' } });
});

// === Back to main ===
bot.action('back_main', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  await showMainMenu(ctx);
});

// === Facility Registration flow (3 steps) ===
bot.action('start_reg_fac', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(()=>{});
    flows.set(ctx.from.id, { flow: 'reg_fac', step: 1, data: {}, ts: Date.now() });
    // edit if possible, fall back to reply
    try { await ctx.editMessageText('Facility Registration (1/3)\nEnter facility name:'); }
    catch { await ctx.reply('Facility Registration (1/3)\nEnter facility name:'); }
  } catch {
    await ctx.reply('Failed to start registration.');
  }
});

bot.on('text', async (ctx, next) => {
  const s = flows.get(ctx.from.id);
  if (!s) return next();

  try {
    if (s.flow === 'reg_fac') {
      const text = ctx.message.text.trim();
      if (s.step === 1) {
        s.data.name = text.slice(0,60);
        if (s.data.name.length < 2) return ctx.reply('Name must be at least 2 characters. Try again:');
        s.step = 2; flows.set(ctx.from.id, s);
        return ctx.reply('City (2/3):');
      }
      if (s.step === 2) {
        s.data.city = text.slice(0,40);
        if (s.data.city.length < 2) return ctx.reply('City must be at least 2 characters. Try again:');
        s.step = 3; flows.set(ctx.from.id, s);
        return ctx.reply('Contact phone (3/3):');
      }
      if (s.step === 3) {
        s.data.phone = text.slice(0,25);
        const user = await ensureUser(ctx);
        // Create facility (inactive) + make user admin member + set as activeFacilityId
        const facility = await prisma.$transaction(async (tx) => {
          const f = await tx.facility.create({
            data: { name: s.data.name, isDefault: false, isActive: false, planTier: 'Free' }
          });
          await tx.facilityMember.create({ data: { userId: user.id, facilityId: f.id, role: 'facility_admin' } });
          await tx.user.update({ where: { id: user.id }, data: { activeFacilityId: f.id, requestedRole: 'facility_admin' } });
          return f;
        });

        flows.delete(ctx.from.id);

        await ctx.reply(
`✅ Facility registration submitted

• Name: ${facility.name}
• City: ${s.data.city}
• Phone: ${s.data.phone}
• Plan: Free
• Status: pending (awaiting activation)`
        );

        if (CONFIG.MASTER_ID) {
          try {
            await bot.telegram.sendMessage(
              CONFIG.MASTER_ID,
              `🔔 New facility request\n• ${facility.name}\n• city: ${s.data.city}\n• phone: ${s.data.phone}\n• id: ${facility.id.toString()}`
            );
          } catch {}
        }
        return;
      }
    }

    if (s.flow === 'new_wo') {
      const text = ctx.message.text.trim();
      if (s.step === 1) {
        s.data.department = text.toLowerCase();
        s.step = 2; flows.set(ctx.from.id, s);
        return ctx.reply('Priority? (low/medium/high)');
      }
      if (s.step === 2) {
        s.data.priority = text.toLowerCase();
        s.step = 3; flows.set(ctx.from.id, s);
        return ctx.reply('Describe the issue:');
      }
      if (s.step === 3) {
        const { user } = await requireMembership(ctx);
        const wo = await prisma.workOrder.create({
          data: {
            facilityId: user.activeFacilityId,
            createdByUserId: user.id,
            status: 'open',
            department: s.data.department,
            priority: s.data.priority,
            description: text.slice(0,500)
          }
        });
        flows.delete(ctx.from.id);
        return ctx.reply(`✅ Request created: #${wo.id.toString()}`);
      }
    }

    return next();
  } catch (e) {
    console.error('FLOW_ERROR', e);
    flows.delete(ctx.from.id);
    return ctx.reply('Flow cancelled due to an error. Try again.');
  }
});

// === Join facility flow ===
bot.action('start_join', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(()=>{});
    const facilities = await prisma.facility.findMany({
      where: { OR: [{ isActive: true }, { isDefault: true }] },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    if (!facilities.length) {
      return ctx.reply('No facilities available to join yet.');
    }
    const rows = facilities.map(f => ([
      { text: `🏢 ${f.name}${f.isDefault ? ' • default' : ''}${!f.isActive ? ' (inactive)' : ''}`, callback_data: `join_fac_${f.id.toString()}` }
    ]));
    rows.push([{ text: '⬅️ Back', callback_data: 'back_main' }]);
    try {
      await ctx.editMessageText('Choose facility to join:', kb(rows));
    } catch {
      await ctx.reply('Choose facility to join:', kb(rows));
    }
  } catch (e) {
    console.error('JOIN_START_ERR', e);
    await ctx.reply('Failed to load facilities.');
  }
});

bot.on('callback_query', async (ctx, next) => {
  const data = ctx.callbackQuery?.data || '';
  if (!data.startsWith('join_fac_')) return next();
  try {
    await ctx.answerCbQuery().catch(()=>{});
    const facilityId = BigInt(data.replace('join_fac_', ''));
    const f = await prisma.facility.findUnique({ where: { id: facilityId } });
    if (!f || !f.isActive) return ctx.answerCbQuery('Facility not available', { show_alert: true });
    flows.set(ctx.from.id, { flow: 'join', step: 2, facilityId, ts: Date.now() });
    const rows = [[
      { text: '👤 User',        callback_data: 'role_user' },
      { text: '🛠️ Technician', callback_data: 'role_technician' },
      { text: '🧭 Supervisor',  callback_data: 'role_supervisor' },
    ]];
    await ctx.editMessageText(`Selected: ${f.name}\nChoose your role:`, kb(rows));
  } catch (e) {
    console.error('JOIN_SELECT_ERR', e);
    await ctx.answerCbQuery('Error selecting facility', { show_alert: true });
  }
});

bot.on('callback_query', async (ctx, next) => {
  const data = ctx.callbackQuery?.data || '';
  if (!data.startsWith('role_')) return next();
  try {
    await ctx.answerCbQuery().catch(()=>{});
    const s = flows.get(ctx.from.id);
    if (!s || s.flow !== 'join' || s.step !== 2) {
      return ctx.answerCbQuery('Session expired, use /start', { show_alert: true });
    }
    const role = data.replace('role_', ''); // user | technician | supervisor
    const tgId = BigInt(ctx.from.id);
    let user = await prisma.user.findUnique({ where: { tgId } });
    if (!user) {
      user = await prisma.user.create({ data: { tgId, firstName: ctx.from.first_name ?? null, status: 'pending' } });
    }
    await prisma.user.update({ where: { id: user.id }, data: { requestedRole: role } });
    const req = await prisma.facilitySwitchRequest.create({
      data: { userId: user.id, fromFacilityId: user.activeFacilityId ?? null, toFacilityId: s.facilityId, status: 'pending' }
    });
    flows.delete(ctx.from.id);
    await ctx.editMessageText(
      `Join request sent\nFacility: ${s.facilityId.toString()}\nRole: ${role}\nStatus: pending (awaiting approval)`
    );
    if (CONFIG.MASTER_ID) {
      try {
        await bot.telegram.sendMessage(CONFIG.MASTER_ID,
          `🔔 Join request: tg:${tgId.toString()} → fac#${s.facilityId.toString()} • role:${role} • req#${req.id.toString()}`
        );
      } catch {}
    }
  } catch (e) {
    console.error('ROLE_ERR', e);
    await ctx.answerCbQuery('Error creating request', { show_alert: true });
  }
});

// === Issues (My / Manage) ===
const PAGE = CONFIG.PAGE_SIZE;

bot.action(/^wo:my\|(\d+)\|(all|Open|In Progress|Closed)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  const page = parseInt(ctx.match[1], 10) || 1;
  const filter = ctx.match[2];
  const { user } = await requireMembership(ctx);

  const whereBase = { facilityId: user.activeFacilityId, createdByUserId: user.id };
  const where = (filter === 'all') ? whereBase : { ...whereBase, status: filter.toLowerCase().replace(' ', '_') };

  const total = await prisma.workOrder.count({ where });
  if (!total) return ctx.reply('No matching requests.');

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const current = Math.min(Math.max(1, page), totalPages);
  const items = await prisma.workOrder.findMany({
    where, orderBy: { updatedAt: 'desc' }, skip: (current - 1) * PAGE, take: PAGE
  });

  let msg = `My Issues (page ${current}/${totalPages}, filter: ${filter}):\n`;
  for (const r of items) {
    const st = r.status.replace('_',' ').toUpperCase();
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

  await ctx.reply(msg, kb([nav].filter(r=>r.length).concat([filters]).concat([[{ text:'⬅️ Back', callback_data:'back_main'}]])));
});

bot.action('wo:start_new', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  await requireMembership(ctx);
  flows.set(ctx.from.id, { flow: 'new_wo', step: 1, data: {}, ts: Date.now() });
  return ctx.reply('Department? (e.g., civil/electrical/mechanical)');
});

bot.action(/^wo:manage\|(\d+)\|(all|Open|In Progress|Closed)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  const page = parseInt(ctx.match[1], 10) || 1;
  const filter = ctx.match[2];
  const { user, member } = await requireMembership(ctx);
  if (!['facility_admin','supervisor','technician'].includes(member.role)) return ctx.reply('Not authorized.');

  const whereBase = { facilityId: user.activeFacilityId };
  const where = (filter === 'all') ? whereBase : { ...whereBase, status: filter.toLowerCase().replace(' ','_') };
  const total = await prisma.workOrder.count({ where });
  if (!total) return ctx.reply('No requests.');

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const current = Math.min(Math.max(1, page), totalPages);
  const items = await prisma.workOrder.findMany({
    where, orderBy: { updatedAt: 'desc' }, skip: (current - 1) * PAGE, take: PAGE
  });

  let msg = `Requests (page ${current}/${totalPages}, filter: ${filter}):\n`;
  const rows = [];
  for (const r of items) {
    const st = r.status.replace('_', ' ');
    msg += `• #${r.id.toString()} — ${st} — ${(r.description || '').slice(0,40)}\n`;
    const row = [];
    if (r.status !== 'in_progress') row.push({ text: '🟠 In Progress', callback_data: `wo:status|${r.id}|In Progress` });
    if (r.status !== 'closed')      row.push({ text: '🟢 Close',       callback_data: `wo:status|${r.id}|Closed` });
    if (r.status !== 'open')        row.push({ text: '🔴 Reopen',      callback_data: `wo:status|${r.id}|Open` });
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

  await ctx.reply(msg, kb([nav].filter(r=>r.length).concat([filters]).concat(rows).concat([[{ text:'⬅️ Back', callback_data:'back_main'}]])));
});

bot.action(/^wo:status\|(\d+)\|(Open|In Progress|Closed)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  const id = BigInt(ctx.match[1]);
  const newLabel = ctx.match[2];
  const newStatus = newLabel.toLowerCase().replace(' ', '_');
  const { user, member } = await requireMembership(ctx);
  if (!['facility_admin','supervisor','technician'].includes(member.role)) return ctx.reply('Not authorized.');

  const wo = await prisma.workOrder.findUnique({ where: { id } });
  if (!wo || wo.facilityId !== user.activeFacilityId) return ctx.reply('Not found.');

  const old = wo.status;
  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id }, data: { status: newStatus } });
    await tx.statusHistory.create({ data: { workOrderId: id, oldStatus: old, newStatus, updatedByUserId: user.id } });
  });

  return ctx.reply(`✅ WO #${id.toString()} updated: ${old} → ${newStatus}`);
});

// === Master Panel (preserved) ===
bot.command('master', async (ctx) => {
  if (!isMaster(ctx)) return ctx.reply('Only master can access this panel.');
  try {
    const [pendingFacilities, activeFacilities, totalFacilities, pendingJoinRequests] = await Promise.all([
      prisma.facility.count({ where: { isActive: false } }),
      prisma.facility.count({ where: { isActive: true } }),
      prisma.facility.count(),
      prisma.facilitySwitchRequest.count({ where: { status: 'pending' } }).catch(()=>0),
    ]);

    const text =
`🛠️ Master Panel
Pending Facilities: ${pendingFacilities}
Pending Join Requests: ${pendingJoinRequests}
Active Facilities: ${activeFacilities}
Total Facilities: ${totalFacilities}

Choose:`;
    const rows = [
      [{ text: '🏢 Pending Facilities', callback_data: 'mf_list' }],
      [{ text: '👥 Pending Join Requests', callback_data: 'mj_list' }],
      [{ text: '📋 List Facilities (active/default)', callback_data: 'mf_list_fac' }],
    ];
    await ctx.reply(text, kb(rows));
  } catch (e) {
    console.error('MASTER_ERR', e);
    await ctx.reply('Failed to open master panel.');
  }
});

bot.on('callback_query', async (ctx, next) => {
  const data = ctx.callbackQuery?.data || '';
  const isMine = ['mf_list','mj_list','mf_list_fac'].some(p => data.startsWith(p)) || data.startsWith('mf_appr_') || data.startsWith('mj_');
  if (!isMine) return next();
  if (!isMaster(ctx)) { await ctx.answerCbQuery('Not allowed', { show_alert: true }); return; }

  if (data === 'mf_list') {
    await ctx.answerCbQuery().catch(()=>{});
    const items = await prisma.facility.findMany({ where: { isActive: false }, take: 10, orderBy: { createdAt: 'asc' } });
    if (!items.length) return ctx.answerCbQuery('No pending facilities', { show_alert: true });
    const lines = items.map(f => `• ${f.id.toString()} — ${f.name}`).join('\n');
    await ctx.editMessageText(`Pending Facilities:\n${lines}\n\nActivate with:`, kb(
      items.map(f => ([
        { text: `✅ Free #${f.id.toString()}`,     callback_data: `mf_appr_Free_${f.id.toString()}` },
        { text: `✅ Pro #${f.id.toString()}`,      callback_data: `mf_appr_Pro_${f.id.toString()}` },
        { text: `✅ Business #${f.id.toString()}`, callback_data: `mf_appr_Business_${f.id.toString()}` },
      ]))
    ));
    return;
  }

  if (data.startsWith('mf_appr_')) {
    await ctx.answerCbQuery().catch(()=>{});
    const [, , plan, fidStr] = data.split('_');
    const facilityId = BigInt(fidStr);
    await prisma.facility.update({ where: { id: facilityId }, data: { isActive: true, planTier: plan } });
    return ctx.editMessageText(`✅ Facility #${fidStr} activated with plan: ${plan}`);
  }

  if (data === 'mj_list') {
    await ctx.answerCbQuery().catch(()=>{});
    const reqs = await prisma.facilitySwitchRequest.findMany({ where: { status: 'pending' }, take: 10, orderBy: { createdAt: 'asc' } });
    if (!reqs.length) return ctx.answerCbQuery('No pending requests', { show_alert: true });
    const lines = await Promise.all(reqs.map(async r => {
      const u = await prisma.user.findUnique({ where: { id: r.userId } });
      const f = r.toFacilityId ? await prisma.facility.findUnique({ where: { id: r.toFacilityId } }) : null;
      return `• req#${r.id.toString()} — tg:${u?.tgId?.toString() ?? '?'} → ${f?.name ?? '?'}`;
    }));
    await ctx.editMessageText(`Pending Join Requests:\n${lines.join('\n')}\n\nChoose:`, kb(reqs.map(r => ([
      { text: `✅ Approve #${r.id.toString()}`, callback_data: `mj_appr_${r.id.toString()}` },
      { text: `⛔ Deny #${r.id.toString()}`,    callback_data: `mj_den_${r.id.toString()}` },
    ]))));
    return;
  }

  if (data.startsWith('mj_appr_')) {
    await ctx.answerCbQuery().catch(()=>{});
    const rid = BigInt(data.replace('mj_appr_', ''));
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
    if (user.tgId) { try { await bot.telegram.sendMessage(user.tgId.toString(), `✅ Your join request has been approved.`); } catch {} }
    return ctx.editMessageText(`✅ Approved req #${rid.toString()}`);
  }

  if (data.startsWith('mj_den_')) {
    await ctx.answerCbQuery().catch(()=>{});
    const rid = BigInt(data.replace('mj_den_', ''));
    const req = await prisma.facilitySwitchRequest.findUnique({ where: { id: rid } });
    if (!req) return ctx.answerCbQuery('Not found', { show_alert: true });
    await prisma.facilitySwitchRequest.update({ where: { id: rid }, data: { status: 'rejected' } });
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (user?.tgId) { try { await bot.telegram.sendMessage(user.tgId.toString(), `⛔ Your join request has been denied.`); } catch {} }
    return ctx.editMessageText(`⛔ Denied req #${rid.toString()}`);
  }

  if (data === 'mf_list_fac') {
    await ctx.answerCbQuery().catch(()=>{});
    const facs = await prisma.facility.findMany({
      where: { OR: [{ isActive: true }, { isDefault: true }] },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take: 100
    });
    if (!facs.length) return ctx.reply('No facilities (active/default) found.');
    const lines = facs.map(f => `• ${f.name} — ${f.isActive ? 'active' : 'inactive'}${f.isDefault ? ' • default' : ''}`);
    return ctx.reply(lines.join('\n'));
  }
});

// === New Issue entry point ===
bot.action('wo:start_new', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  await requireMembership(ctx);
  flows.set(ctx.from.id, { flow: 'new_wo', step: 1, data: {}, ts: Date.now() });
  return ctx.reply('Department? (e.g., civil/electrical/mechanical)');
});

// === Webhook bootstrap (idempotent) ===
if (!g._webhookConfigured) {
  g._webhookConfigured = true;
  const webhookUrl = `${CONFIG.PUBLIC_URL}${CONFIG.WEBHOOK_PATH}`;
  bot.telegram.setWebhook(webhookUrl, {
    allowed_updates: CONFIG.ALLOWED_UPDATES,
    drop_pending_updates: false
  }).then(() => {
    console.log('✅ Webhook configured:', webhookUrl);
  }).catch((err) => {
    console.error('❌ Webhook setup failed:', err?.message || err);
  });
}

const handler = bot.webhookCallback(CONFIG.WEBHOOK_PATH);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 200;
    return res.end('OK');
  }
  try {
    return await handler(req, res);
  } catch (e) {
    console.error('WEBHOOK_HANDLER_ERROR', e);
    res.statusCode = 200; // avoid retries storm
    return res.end('OK');
  }
};

module.exports.config = { runtime: 'nodejs20' };

