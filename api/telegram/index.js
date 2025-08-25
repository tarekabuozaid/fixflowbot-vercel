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
  // Auto display registration/join for non-setup users
  bot.start(async (ctx) => {
    const user = await ensureUser(ctx);
    const needOnboarding = user.status === 'pending' || !user.activeFacilityId;
    if (needOnboarding) {
      return ctx.replyWithMarkdown(
        `👋 *Welcome!* Choose an action to start:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🆕 Register New Facility', 'start_reg_fac')],
          [Markup.button.callback('👥 Join Facility', 'start_join')]
        ])
      );
    }
    return ctx.reply('✅ You are ready. Use /me or /newwo');
  });

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

  // === Flows: Register Facility + Join (reuse existing handlers if present) ===
  // Start facility registration flow from button
  // Depends on text handler below (reg_fac steps)
  // Assumes facility and membership creation code as we added before.
  // If not present, we'll complete below with flow text.
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (data === 'start_reg_fac') {
      try {
        await ctx.answerCbQuery().catch(() => {});
        beginFlow(ctx); // ← Important: mark that we're entering a flow
        state.set(ctx.from.id, { flow: 'reg_fac', step: 1, data: {} });
        await ctx.editMessageText('🏢 Enter *facility name*:', { parse_mode: 'Markdown' });
        return;
      } catch (e) {
        endFlow(ctx);
        return ctx.reply('Failed to start registration flow. Please try again.');
      }
    }
    return next();
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

  // Start join flow from button: show active facilities
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (data === 'start_join') {
      try {
        await ctx.answerCbQuery().catch(() => {});
        beginFlow(ctx); // ← Important: mark that we're entering a flow

        // جِلب منشآت قابلة للانضمام:
        // - المفعّلة isActive=true
        // - أو المعلّمة افتراضيًا isDefault=true (حتى لو غير مفعّلة)
        const facilities = await prisma.facility.findMany({
          where: {
            OR: [{ isActive: true }, { isDefault: true }]
          },
          orderBy: { createdAt: 'desc' },
          take: 50
        });

        if (!facilities.length) {
          endFlow(ctx);
          await ctx.answerCbQuery('No facilities available to join', { show_alert: true }).catch(()=>{});
          await ctx.reply('No facilities are available to join yet. Ask the master to activate or mark one as default.');
          return;
        }

        const rows = facilities.map(f => ([
          { text: `🏢 ${f.name}${f.isDefault ? ' • default' : ''}${!f.isActive ? ' (inactive)' : ''}`, callback_data: `join_fac_${f.id.toString()}` }
        ]));

        // حاول تعديل الرسالة؛ ولو فشل (مثلاً الرسالة ليست من البوت) استخدم reply
        try {
          await ctx.editMessageText('Choose facility to join:', {
            reply_markup: { inline_keyboard: rows }
          });
        } catch {
          await ctx.reply('Choose facility to join:', {
            reply_markup: { inline_keyboard: rows }
          });
        }
      } catch (e) {
        endFlow(ctx);
        await ctx.reply('Failed to start join flow. Please try again.');
      }
    }
    return next();
  });

  // Choose facility → choose role
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('join_fac_')) return next();
    const facilityId = BigInt(data.replace('join_fac_', ''));
    const f = await prisma.facility.findUnique({ where: { id: facilityId } });
    if (!f || !f.isActive) return ctx.answerCbQuery('Facility not available now', { show_alert: true });
    state.set(ctx.from.id, { flow: 'join', step: 2, facilityId });
    const rows = [
      [
        { text: '👤 User',        callback_data: 'role_user' },
        { text: '🛠️ Technician', callback_data: 'role_technician' },
        { text: '🧭 Supervisor',  callback_data: 'role_supervisor' },
      ]
    ];
    await ctx.editMessageText(`Choose your role to join: ${f.name}`, kb(rows));
  });

  // Create join request as pending + notify master
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('role_')) return next();
    const role = data.replace('role_', ''); // user | technician | supervisor
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
      endFlow(ctx); // ← Important: exit the flow
      const facility = await prisma.facility.findUnique({ where: { id: s.facilityId } });
      await ctx.editMessageText(
`📝 *Join Request Received*
—  
Facility: ${facility?.name}
Requested Role: ${role}
Status: ⏳ pending (awaiting admin approval)`, { parse_mode: 'Markdown' }
      );
      if (process.env.MASTER_ID) {
        try {
          await bot.telegram.sendMessage(
            process.env.MASTER_ID,
            `🔔 Join request:\n• user ${tgId.toString()} → ${facility?.name}\n• role: ${role}\n• req#${req.id.toString()}`
          );
        } catch {}
      }
    } catch (e) {
      console.error('JOIN_CREATE_REQ_ERROR', e);
      endFlow(ctx); // ← Important: exit the flow on error
      await ctx.answerCbQuery('Error creating request', { show_alert: true });
    }
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

  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (!['mf_list','mj_list','mf_list_fac'].includes(data) && !data.startsWith('mf_') && !data.startsWith('mj_')) return next();
    if (!isMaster(ctx)) {
      await ctx.answerCbQuery('Not allowed', { show_alert: true });
      return;
    }

    // Pending facilities
    if (data === 'mf_list') {
      await ctx.answerCbQuery().catch(() => {});
      const items = await prisma.facility.findMany({ where: { isActive: false }, take: 10, orderBy: { createdAt: 'asc' } });
      if (!items.length) return ctx.answerCbQuery('No pending facilities', { show_alert: true });
      const lines = items.map(f => `• ${f.id.toString()} — ${f.name}`).join('\n');
      await ctx.editMessageText(`🏢 Pending Facilities:\n${lines}\n\nChoose facility to activate with plan:`, kb(
        items.map(f => ([
          { text: `✅ Free #${f.id.toString()}`,     callback_data: `mf_appr_Free_${f.id.toString()}` },
          { text: `✅ Pro #${f.id.toString()}`,      callback_data: `mf_appr_Pro_${f.id.toString()}` },
          { text: `✅ Business #${f.id.toString()}`, callback_data: `mf_appr_Business_${f.id.toString()}` },
        ]))
      ));
      return;
    }
    if (data.startsWith('mf_appr_')) {
      const [, , plan, fidStr] = data.split('_'); // ['mf','appr','Free','123']
      const facilityId = BigInt(fidStr);
      await prisma.facility.update({ where: { id: facilityId }, data: { isActive: true, planTier: plan } });
      await ctx.answerCbQuery('Facility activated ✅');
      return ctx.editMessageText(`✅ Facility #${fidStr} activated with plan: ${plan}`);
    }

    // Pending join requests
    if (data === 'mj_list') {
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
        kb(reqs.map(r => ([
          { text: `✅ Approve #${r.id.toString()}`, callback_data: `mj_appr_${r.id.toString()}` },
          { text: `⛔ Deny #${r.id.toString()}`,    callback_data: `mj_den_${r.id.toString()}` },
        ])))
      );
      return;
    }
    if (data.startsWith('mj_appr_')) {
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
      await ctx.answerCbQuery('Approved ✅');
      return ctx.editMessageText(`✅ Approved req #${rid.toString()}`);
    }
    if (data.startsWith('mj_den_')) {
      const rid = BigInt(data.replace('mj_den_', ''));
      const req = await prisma.facilitySwitchRequest.findUnique({ where: { id: rid } });
      if (!req) return ctx.answerCbQuery('Not found', { show_alert: true });
      await prisma.facilitySwitchRequest.update({ where: { id: rid }, data: { status: 'rejected' } });
      const user = await prisma.user.findUnique({ where: { id: req.userId } });
      if (user?.tgId) { try { await bot.telegram.sendMessage(user.tgId.toString(), `⛔ Your join request has been denied.`); } catch {} }
      await ctx.answerCbQuery('Denied');
      return ctx.editMessageText(`⛔ Denied req #${rid.toString()}`);
    }

    // List facilities for master (active OR default)
    if (data === 'mf_list_fac') {
      try {
        await ctx.answerCbQuery().catch(()=>{});
        if (String(ctx.from.id) !== String(process.env.MASTER_ID)) return;

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
        await ctx.reply('Failed to list facilities.');
      }
    }
  });

  // Set webhook
  const webhookUrl = `${publicUrl}${webhookPath}`;
  bot.telegram.setWebhook(webhookUrl).catch(() => {});

  const handle = bot.webhookCallback(webhookPath);
  module.exports = async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 200;
      return res.end('OK');
    }
    return handle(req, res);
  };

  module.exports.config = { runtime: 'nodejs20' };
}

