// api/telegram/index.js
const { Telegraf, Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const token = process.env.BOT_TOKEN;
const publicUrl = process.env.PUBLIC_URL;
const webhookPath = '/api/telegram';

// Prisma client with cache
const g = globalThis;
const prisma = g._prisma ?? new PrismaClient();
if (!g._prisma) g._prisma = prisma;

// --- FLOW GUARD (minimal, non-breaking) ---
const FLOW_USERS = new Set();

function beginFlow(ctx) { if (ctx?.from?.id) FLOW_USERS.add(ctx.from.id); }
function endFlow(ctx)   { if (ctx?.from?.id) FLOW_USERS.delete(ctx.from.id); }
function isInFlow(ctx)  { return !!(ctx?.from?.id && FLOW_USERS.has(ctx.from.id)); }

// Smart onboarding menu (English as agreed)
async function sendOnboardingMenu(ctx) {
  try {
    return ctx.reply(
      'Choose an action to start:',
      Markup.inlineKeyboard([
        [Markup.button.callback('🆕 Register New Facility', 'start_reg_fac')],
        [Markup.button.callback('👥 Join Facility', 'start_join')],
      ])
    );
  } catch (_) { /* no-op */ }
}

if (!token || !publicUrl) {
  module.exports = (req, res) => {
    res.statusCode = 500;
    return res.end('Missing BOT_TOKEN or PUBLIC_URL');
  };
  module.exports.config = { runtime: 'nodejs20' };
} else {
  const bot = new Telegraf(token, { handlerTimeout: 9000 });

  bot.catch((err, ctx) => {
    console.error('TELEGRAM_ERROR', { err: err.message, from: ctx?.from?.id });
  });

  // === 0) Fast ACK + Global logs for callback queries ===
  bot.on('callback_query', async (ctx, next) => {
    try {
      // ACK فوري (يسكت الـ spinner حتى لو حصلت أخطاء لاحقًا)
      await ctx.answerCbQuery().catch(() => {});
    } catch (_) {}

    try {
      // لوج مفيد للتشخيص
      const u = ctx.from?.id;
      const data = ctx.callbackQuery?.data;
      const type = ctx.updateType;
      console.log('CBQ_IN', { u, type, data });
    } catch (_) {}

    // مرّر للـ handlers المتخصصة
    return next();
  });

  // Helper: edit-or-reply (لو فشلت editMessageText نعمل reply)
  async function safeEditOrReply(ctx, text, extra) {
    try {
      await ctx.editMessageText(text, extra);
    } catch {
      await ctx.reply(text, extra);
    }
  }

  // === helpers & state (NEW) ===
  const state = new Map(); // per-user short flows
  function kb(rows) { return { reply_markup: { inline_keyboard: rows } }; }
  function isMaster(ctx) { return String(ctx.from?.id) === String(process.env.MASTER_ID || ''); }
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
    const member = await prisma.facilityMember.findFirst({ where: { userId: user.id, facilityId: user.activeFacilityId } });
    return { user, member };
  }
  function assertRole(member, ...allowed) { if (!member || !allowed.includes(member.role)) throw new Error('forbidden'); }

  // Simple test
  bot.command('ping', (ctx) => ctx.reply('pong ✅'));

  // /me command: creates user if not exists and shows status & facility
  bot.command('me', async (ctx) => {
    try {
      const tgId = BigInt(ctx.from.id);
      const firstName = ctx.from.first_name ?? null;

      // Create user if not exists
      let user = await prisma.user.findUnique({ where: { tgId } });
      if (!user) {
        user = await prisma.user.create({
          data: { tgId, firstName, status: 'pending' },
        });
      }

      const activeFacility = user.activeFacilityId
        ? await prisma.facility.findUnique({ where: { id: user.activeFacilityId } })
        : null;

      const membership = await prisma.facilityMember.findFirst({
        where: { userId: user.id },
        include: { facility: true },
      });

      const lines = [
        `🧍‍♂️ *User*`,
        `id: ${user.id.toString()}`,
        `tgId: ${ctx.from.id}`,
        `status: ${user.status}`,
        user.requestedRole ? `requestedRole: ${user.requestedRole}` : null,
        '',
        `🏢 *Active facility*: ${activeFacility ? activeFacility.name : '—'}`,
        `👥 *Membership*: ${membership ? `${membership.role} @ ${membership.facility.name}` : '—'}`,
      ].filter(Boolean);

      await ctx.replyWithMarkdown(lines.join('\n'));
    } catch (e) {
      console.error('ME_CMD_ERROR', e.message);
      await ctx.reply('⚠️ Error in /me command');
    }
  });

  // === Smart Onboarding (NEW) ===
  // Main menu (inline keyboard)
  async function showMainMenu(ctx) {
    const me = await ensureUser(ctx);
    const inline = [];
    if (me.status !== 'active' || !me.activeFacilityId) {
      inline.push([{ text: '🆕 Register Facility', callback_data: 'start_reg_fac' }]);
      inline.push([{ text: '👥 Join Facility', callback_data: 'start_join' }]);
    } else {
      inline.push([{ text: '➕ New Issue', callback_data: 'wo:start_new' }, { text: '📋 My Issues', callback_data: 'wo:my|1|all' }]);
      // Admin/Tech rows
      const member = await prisma.facilityMember.findFirst({ where: { userId: me.id, facilityId: me.activeFacilityId } });
      const canManage = member && ['facility_admin', 'supervisor', 'technician'].includes(member.role);
      if (canManage) inline.push([{ text: '🔧 Manage Requests', callback_data: 'wo:manage|1|all' }]);
      inline.push([{ text: '❓ Help', callback_data: 'help' }]);
    }
    await ctx.reply('Choose an action:', { reply_markup: { inline_keyboard: inline } });
  }

  bot.command('start', async (ctx) => showMainMenu(ctx));
  bot.action('help', async (ctx) => { await ctx.reply('FixFlowBot helps you create and track maintenance requests.'); });

  // ⚠️ Replace old message handler with this middleware:
  bot.use(async (ctx, next) => {
    try {
      // Don't intercept commands/callbacks or messages during Flow
      if (ctx.updateType === 'callback_query') return next();
      if (ctx.message?.text?.startsWith('/')) return next();
      if (isInFlow(ctx)) return next();

      // Get user status
      const user = await ensureUser(ctx);
      const noActive = !user.activeFacilityId;
      const isPending = user.status !== 'active';

      // If user not ready: show onboarding menu but don't block other handlers
      if (isPending || noActive) {
        await sendOnboardingMenu(ctx);
        // Note: don't return here; allow next() so other handlers can work
        // but try not to repeat menu unless no flow is active
        return next();
      }

      // Ready user → pass through normally
      return next();
    } catch (err) {
      // In case of unexpected error, don't stop flows
      return next();
    }
  });

  // === Flows: Register Facility + Join (explicit handlers) ===
  // Start: Register Facility flow (explicit action)
  bot.action('start_reg_fac', async (ctx) => {
    try {
      beginFlow(ctx);
      state.set(ctx.from.id, { flow: 'reg_fac', step: 1, data: {} });
      await safeEditOrReply(ctx, '🏢 Enter *facility name*:', { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('START_REG_FAC_ERR', e);
      endFlow(ctx);
      await ctx.reply('Failed to start registration flow. Please try again.');
    }
  });

  // Start: Join Facility picker (explicit action)
  bot.action('start_join', async (ctx) => {
    try {
      beginFlow(ctx);

      // إظهار المنشآت المتاحة: isActive=true أو isDefault=true كما اتفقنا
      const facilities = await prisma.facility.findMany({
        where: { OR: [{ isActive: true }, { isDefault: true }] },
        orderBy: { createdAt: 'desc' },
        take: 50
      });

      if (!facilities.length) {
        endFlow(ctx);
        await ctx.answerCbQuery('No facilities available to join', { show_alert: true }).catch(()=>{});
        return ctx.reply('No facilities are available to join yet. Ask the master to activate or mark one as default.');
      }

      const rows = facilities.map(f => ([
        { text: `🏢 ${f.name}${f.isDefault ? ' • default' : ''}${!f.isActive ? ' (inactive)' : ''}`, callback_data: `join_fac_${f.id.toString()}` }
      ]));

      await safeEditOrReply(ctx, 'Choose facility to join:', { reply_markup: { inline_keyboard: rows } });
    } catch (e) {
      console.error('START_JOIN_ERR', e);
      endFlow(ctx);
      await ctx.reply('Failed to start join flow. Please try again.');
    }
  });

  // Text flow for facility registration (3 steps)
  bot.on('text', async (ctx, next) => {
    const s = state.get(ctx.from.id);
    if (!s || s.flow !== 'reg_fac') return next();
    if (s.step === 1) {
      s.data = s.data || {};
      s.data.name = ctx.message.text.trim().slice(0, 60);
      s.step = 2;
      return ctx.reply('🏙️ City?');
    }
    if (s.step === 2) {
      s.data.city = ctx.message.text.trim().slice(0, 40);
      s.step = 3;
      return ctx.reply('📞 Contact phone?');
    }
    if (s.step === 3) {
      s.data.phone = ctx.message.text.trim().slice(0, 25);
      try {
        const tgId = BigInt(ctx.from.id);
        let user = await prisma.user.findUnique({ where: { tgId } });
        if (!user) {
          user = await prisma.user.create({
            data: { tgId, firstName: ctx.from.first_name ?? null, status: 'active' }
          });
        }
        const facility = await prisma.facility.create({
          data: { name: s.data.name, isDefault: false, isActive: false, planTier: 'Free' }
        });
        await prisma.facilityMember.create({
          data: { userId: user.id, facilityId: facility.id, role: 'facility_admin' }
        });
        await prisma.user.update({
          where: { id: user.id },
          data: { activeFacilityId: facility.id, requestedRole: 'facility_admin' }
        });
        state.delete(ctx.from.id);
        endFlow(ctx); // ← Important: exit the flow
        await ctx.replyWithMarkdown(
`📦 *Facility Registration Request Received*
—  
*Name:* ${facility.name}
*City:* ${s.data.city}
*Phone:* ${s.data.phone}
*Plan:* Free  
*Status:* ⏳ pending (awaiting Master approval)`
        );
        if (process.env.MASTER_ID) {
          try {
            await bot.telegram.sendMessage(
              process.env.MASTER_ID,
              `🔔 New facility request:\n• ${facility.name}\n• city: ${s.data.city}\n• phone: ${s.data.phone}`
            );
          } catch {}
        }
      } catch (e) {
        console.error('REGISTER_FAC_ERROR', e);
        state.delete(ctx.from.id);
        endFlow(ctx); // ← Important: exit the flow on error
        await ctx.reply('⚠️ Error during registration. Try again later.');
      }
      return;
    }
  });



    // Pick facility → move to role selection
  bot.action(/^join_fac_(\d+)$/, async (ctx) => {
    try {
      const fid = BigInt(ctx.match[1]);
      const f = await prisma.facility.findUnique({ where: { id: fid } });
      if (!f || !f.isActive) {
        return ctx.answerCbQuery('Facility not available now', { show_alert: true });
      }

      state.set(ctx.from.id, { flow: 'join', step: 2, facilityId: fid });

      const rows = [[
        { text: '👤 User',        callback_data: 'role_user' },
        { text: '🛠️ Technician', callback_data: 'role_technician' },
        { text: '🧭 Supervisor',  callback_data: 'role_supervisor' },
      ]];

      await safeEditOrReply(ctx, `Choose your role to join: ${f.name}`, { reply_markup: { inline_keyboard: rows } });
    } catch (e) {
      console.error('JOIN_FAC_SELECT_ERR', e);
      await ctx.answerCbQuery('Error selecting facility', { show_alert: true });
    }
  });

  // Pick role → create pending request
  bot.action(/^role_(user|technician|supervisor)$/, async (ctx) => {
    const role = ctx.match[1]; // user | technician | supervisor
    const s = state.get(ctx.from.id);
    if (!s || s.flow !== 'join' || s.step !== 2) {
      return ctx.answerCbQuery('Session expired, send /start again', { show_alert: true });
    }
    try {
      const tgId = BigInt(ctx.from.id);
      let user = await prisma.user.findUnique({ where: { tgId } });
      if (!user) {
        user = await prisma.user.create({
          data: { tgId, firstName: ctx.from.first_name ?? null, status: 'pending' }
        });
      }
      await prisma.user.update({ where: { id: user.id }, data: { requestedRole: role } });
      const req = await prisma.facilitySwitchRequest.create({
        data: {
          userId: user.id,
          fromFacilityId: user.activeFacilityId ?? null,
          toFacilityId: s.facilityId,
          status: 'pending'
        }
      });

      state.delete(ctx.from.id);
      endFlow(ctx);

      const facility = await prisma.facility.findUnique({ where: { id: s.facilityId } });
      await safeEditOrReply(ctx,
        `📝 *Join Request Received*\n—  \nFacility: ${facility?.name}\nRequested Role: ${role}\nStatus: ⏳ pending (awaiting admin approval)`,
        { parse_mode: 'Markdown' }
      );

      if (process.env.MASTER_ID) {
        bot.telegram.sendMessage(
          process.env.MASTER_ID,
          `🔔 Join request:\n• user ${tgId.toString()} → ${facility?.name}\n• role: ${role}\n• req#${req.id.toString()}`
        ).catch(()=>{});
      }
    } catch (e) {
      console.error('JOIN_CREATE_REQ_ERROR', e);
      endFlow(ctx);
      await ctx.answerCbQuery('Error creating request', { show_alert: true });
    }
  });

  // === My Issues (pagination + filter) ===
  const PAGE_SIZE = 5;

  bot.action(/^wo:my\|(\d+)\|(all|Open|In Progress|Closed)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10) || 1;
    const filter = ctx.match[2];
    const { user } = await requireMembership(ctx);

    const whereBase = { facilityId: user.activeFacilityId, createdByUserId: user.id };
    const where = (filter === 'all') ? whereBase : { ...whereBase, status: filter.toLowerCase().replace(' ', '_') };

    const total = await prisma.workOrder.count({ where });
    if (!total) { return ctx.reply('No matching requests.'); }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(1, page), totalPages);

    const items = await prisma.workOrder.findMany({
      where, orderBy: { updatedAt: 'desc' }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE
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

  bot.action('back_main', async (ctx) => { return showMainMenu(ctx); });

  // === Minimal new issue conversation (3 steps) ===
  const _scenes = {}; // light-weight memory

  bot.action('wo:start_new', async (ctx) => {
    await requireMembership(ctx);
    _scenes[ctx.from.id] = { step: 1, data: {} };
    return ctx.reply('Department? (e.g., civil/electrical/mechanical)');
  });

  bot.on('text', async (ctx) => {
    const S = _scenes[ctx.from.id];
    if (!S) return;
    if (S.step === 1) { S.data.department = ctx.message.text.trim(); S.step = 2; return ctx.reply('Priority? (low/medium/high)'); }
    if (S.step === 2) { S.data.priority = ctx.message.text.trim(); S.step = 3; return ctx.reply('Describe the issue:'); }
    if (S.step === 3) {
      const { user } = await requireMembership(ctx);
      const wo = await prisma.workOrder.create({
        data: {
          facilityId: user.activeFacilityId, createdByUserId: user.id,
          status: 'open', department: S.data.department.toLowerCase(),
          priority: S.data.priority.toLowerCase(), description: ctx.message.text.trim()
        }
      });
      delete _scenes[ctx.from.id];
      return ctx.reply(`✅ Request created: #${wo.id.toString()}`);
    }
  });

  // === Manage requests (admin/tech) + status updates + timeline ===
  bot.action(/^wo:manage\|(\d+)\|(all|Open|In Progress|Closed)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10) || 1;
    const filter = ctx.match[2];
    const { user, member } = await requireMembership(ctx);
    // صلاحيات
    if (!member || !['facility_admin', 'supervisor', 'technician'].includes(member.role)) return ctx.reply('Not authorized.');

    const whereBase = { facilityId: user.activeFacilityId };
    const where = (filter === 'all') ? whereBase : { ...whereBase, status: filter.toLowerCase().replace(' ', '_') };

    const total = await prisma.workOrder.count({ where });
    if (!total) return ctx.reply('No requests.');

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(1, page), totalPages);
    const items = await prisma.workOrder.findMany({
      where, orderBy: { updatedAt: 'desc' }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE
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
    const { user, member } = await requireMembership(ctx);
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
      if (String(ctx.from.id) !== String(process.env.MASTER_ID)) {
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
    if (!isMaster(ctx)) {
      await ctx.answerCbQuery('Not allowed', { show_alert: true });
      return;
    }

    const items = await prisma.facility.findMany({ where: { isActive: false }, take: 10, orderBy: { createdAt: 'asc' } });
    if (!items.length) return ctx.answerCbQuery('No pending facilities', { show_alert: true });
    const lines = items.map(f => `• ${f.id.toString()} — ${f.name}`).join('\n');
    await safeEditOrReply(ctx, `🏢 Pending Facilities:\n${lines}\n\nChoose facility to activate with plan:`, kb(
      items.map(f => ([
        { text: `✅ Free #${f.id.toString()}`,     callback_data: `mf_appr_Free_${f.id.toString()}` },
        { text: `✅ Pro #${f.id.toString()}`,      callback_data: `mf_appr_Pro_${f.id.toString()}` },
        { text: `✅ Business #${f.id.toString()}`, callback_data: `mf_appr_Business_${f.id.toString()}` },
      ]))
    ));
  });

  // Approve facility
  bot.action(/^mf_appr_(Free|Pro|Business)_(\d+)$/, async (ctx) => {
    if (!isMaster(ctx)) {
      await ctx.answerCbQuery('Not allowed', { show_alert: true });
      return;
    }
    const plan = ctx.match[1];
    const fidStr = ctx.match[2];
    const facilityId = BigInt(fidStr);
    await prisma.facility.update({ where: { id: facilityId }, data: { isActive: true, planTier: plan } });
    await ctx.answerCbQuery('Facility activated ✅');
    return safeEditOrReply(ctx, `✅ Facility #${fidStr} activated with plan: ${plan}`);
  });

  // Pending join requests
  bot.action('mj_list', async (ctx) => {
    if (!isMaster(ctx)) {
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
    await safeEditOrReply(ctx,
      `👥 Pending Join Requests:\n${lines.join('\n')}\n\nChoose action:`,
      kb(reqs.map(r => ([
        { text: `✅ Approve #${r.id.toString()}`, callback_data: `mj_appr_${r.id.toString()}` },
        { text: `⛔ Deny #${r.id.toString()}`,    callback_data: `mj_den_${r.id.toString()}` },
      ])))
    );
  });
  // Approve join request
  bot.action(/^mj_appr_(\d+)$/, async (ctx) => {
    if (!isMaster(ctx)) {
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
    return safeEditOrReply(ctx, `✅ Approved req #${rid.toString()}`);
  });

  // Deny join request
  bot.action(/^mj_den_(\d+)$/, async (ctx) => {
    if (!isMaster(ctx)) {
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
    return safeEditOrReply(ctx, `⛔ Denied req #${rid.toString()}`);
  });

  // List facilities for master (active OR default)
  bot.action('mf_list_fac', async (ctx) => {
    if (!isMaster(ctx)) {
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

  // --- Webhook management (do NOT auto-set on every cold start) ---
  const webhookUrl = `${publicUrl}${webhookPath}`;

  // Prepare one callback to use for incoming POST updates
  const handle = bot.webhookCallback(webhookPath, { timeout: 9000 });

  // Small helper to call Telegram API safely
  async function safeCall(promise) {
    try { return await promise; } catch (e) { return { _error: e?.message || String(e) }; }
  }

  module.exports = async (req, res) => {
    // 1) Management ops (GET with ?op=...)
    if (req.method === 'GET') {
      const op = (req.query?.op || req.query?.OP || '').toString().toLowerCase();

      // Only master can use management ops (optional but recommended)
      // Tip: hit it from your browser after you set MASTER_ID env.
      if (op === 'get') {
        const info = await safeCall(bot.telegram.getWebhookInfo());
        res.setHeader('Content-Type', 'application/json');
        res.status(200).end(JSON.stringify({ webhookUrl, info }, null, 2));
        return;
      }
      if (op === 'set') {
        const del = await safeCall(bot.telegram.deleteWebhook({ drop_pending_updates: false }));
        const set = await safeCall(bot.telegram.setWebhook(webhookUrl /* , { secret_token: process.env.TG_SECRET } */));
        const info = await safeCall(bot.telegram.getWebhookInfo());
        res.setHeader('Content-Type', 'application/json');
        res.status(200).end(JSON.stringify({ webhookUrl, deleted: del, set, info }, null, 2));
        return;
      }
      if (op === 'del') {
        const out = await safeCall(bot.telegram.deleteWebhook({ drop_pending_updates: false }));
        res.setHeader('Content-Type', 'application/json');
        res.status(200).end(JSON.stringify({ deleted: out }, null, 2));
        return;
      }

      // Health probe / default GET
      res.status(200).end('OK');
      return;
    }

    // 2) Incoming updates (POST from Telegram)
    if (req.method === 'POST') {
      // Optional: verify secret header if you configured secret_token above
      // const secret = req.headers['x-telegram-bot-api-secret-token'];
      // if (process.env.TG_SECRET && secret !== process.env.TG_SECRET) {
      //   res.statusCode = 401; return res.end('Bad secret');
      // }

      try {
        return handle(req, res);
      } catch (e) {
        console.error('WEBHOOK_HANDLE_ERR', e?.message);
        res.statusCode = 200; // avoid retries storm; log will show the error
        return res.end('OK');
      }
    }

    // Everything else
    res.statusCode = 200;
    return res.end('OK');
  };

  module.exports.config = { runtime: 'nodejs20' };
}

