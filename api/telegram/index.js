// api/telegram/index.js
const { Telegraf } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

const token = process.env.BOT_TOKEN;
const publicUrl = process.env.PUBLIC_URL;
const webhookPath = '/api/telegram';

// Prisma client مع كاش
const g = globalThis;
const prisma = g._prisma ?? new PrismaClient();
if (!g._prisma) g._prisma = prisma;

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

  // اختبار بسيط
  bot.command('ping', (ctx) => ctx.reply('pong ✅'));

  // أمر /me: يُنشئ المستخدم لو مش موجود ويعرض حالته والمنشأة
  bot.command('me', async (ctx) => {
    try {
      const tgId = BigInt(ctx.from.id);
      const firstName = ctx.from.first_name ?? null;

      // لو المستخدم مش موجود نعمله pending
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
      await ctx.reply('⚠️ حدث خطأ في /me');
    }
  });

  // === Smart Onboarding (NEW) ===
  // عرض تلقائي للتسجيل/الانضمام لغير المهيّأين
  bot.start(async (ctx) => {
    const user = await ensureUser(ctx);
    const needOnboarding = user.status === 'pending' || !user.activeFacilityId;
    if (needOnboarding) {
      return ctx.replyWithMarkdown(
        `👋 *أهلا بيك!* اختر إجراء للبدء:`,
        kb([
          [{ text: '🆕 تسجيل منشأة جديدة', callback_data: 'start_reg_fac' }],
          [{ text: '👥 الانضمام لمنشأة',   callback_data: 'start_join' }]
        ])
      );
    }
    return ctx.reply('✅ أنت جاهز. استخدم /me أو /newwo');
  });
  // أي رسالة من مستخدم غير مهيّأ → أعرض نفس القائمة
  bot.on('message', async (ctx, next) => {
    if (ctx.message?.text?.startsWith('/')) return next();
    const user = await ensureUser(ctx);
    if (user.status === 'pending' || !user.activeFacilityId) {
      return ctx.reply(
        'اختر إجراء للبدء:',
        kb([
          [{ text: '🆕 تسجيل منشأة جديدة', callback_data: 'start_reg_fac' }],
          [{ text: '👥 الانضمام لمنشأة',   callback_data: 'start_join' }]
        ])
      );
    }
    return next();
  });

  // === Flows: Register Facility + Join (reuse existing handlers if present) ===
  // بدء فلو تسجيل منشأة من الزر
  // يعتمد على معالج النصوص أدناه (reg_fac steps)
  // ويفترض وجود كود إنشاء المنشأة والعضوية كما أضفناه سابقًا.
  // لو غير موجود، سنُكمل أدناه مع نصّ الفلو.
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (data === 'start_reg_fac') {
      state.set(ctx.from.id, { flow: 'reg_fac', step: 1, data: {} });
      await ctx.editMessageText('🏢 اكتب *اسم المنشأة*:', { parse_mode: 'Markdown' });
      return;
    }
    return next();
  });

  // فلو نصّي لتسجيل منشأة (3 خطوات)
  bot.on('text', async (ctx, next) => {
    const s = state.get(ctx.from.id);
    if (!s || s.flow !== 'reg_fac') return next();
    if (s.step === 1) {
      s.data = s.data || {};
      s.data.name = ctx.message.text.trim().slice(0, 60);
      s.step = 2;
      return ctx.reply('🏙️ المدينة؟');
    }
    if (s.step === 2) {
      s.data.city = ctx.message.text.trim().slice(0, 40);
      s.step = 3;
      return ctx.reply('📞 هاتف للتواصل؟');
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
        await ctx.replyWithMarkdown(
`📦 *تم استلام طلب تسجيل منشأة*
—  
*الاسم:* ${facility.name}
*المدينة:* ${s.data.city}
*الهاتف:* ${s.data.phone}
*الخطة:* Free  
*الحالة:* ⏳ pending (بانتظار موافقة Master)`
        );
        if (process.env.MASTER_ID) {
          try {
            await bot.telegram.sendMessage(
              process.env.MASTER_ID,
              `🔔 طلب منشأة جديدة:\n• ${facility.name}\n• city: ${s.data.city}\n• phone: ${s.data.phone}`
            );
          } catch {}
        }
      } catch (e) {
        console.error('REGISTER_FAC_ERROR', e);
        state.delete(ctx.from.id);
        await ctx.reply('⚠️ حصل خطأ أثناء التسجيل. حاول لاحقًا.');
      }
      return;
    }
  });

  // بدء فلو الانضمام من الزر: عرض منشآت مفعّلة
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (data === 'start_join') {
      const facilities = await prisma.facility.findMany({
        where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 25
      });
      if (!facilities.length) return ctx.answerCbQuery('لا توجد منشآت مفعّلة حالياً', { show_alert: true });
      const rows = facilities.map(f => [{ text: `🏢 ${f.name}`, callback_data: `join_fac_${f.id.toString()}` }]);
      await ctx.editMessageText('اختر منشأة للانضمام:', kb(rows));
      return;
    }
    return next();
  });

  // اختيار منشأة → اختيار الدور
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('join_fac_')) return next();
    const facilityId = BigInt(data.replace('join_fac_', ''));
    const f = await prisma.facility.findUnique({ where: { id: facilityId } });
    if (!f || !f.isActive) return ctx.answerCbQuery('المنشأة غير متاحة الآن', { show_alert: true });
    state.set(ctx.from.id, { flow: 'join', step: 2, facilityId });
    const rows = [
      [
        { text: '👤 User',        callback_data: 'role_user' },
        { text: '🛠️ Technician', callback_data: 'role_technician' },
        { text: '🧭 Supervisor',  callback_data: 'role_supervisor' },
      ]
    ];
    await ctx.editMessageText(`اختر دورك للانضمام إلى: ${f.name}`, kb(rows));
  });

  // تسجيل طلب الانضمام كـ pending + إشعار الماستر
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('role_')) return next();
    const role = data.replace('role_', ''); // user | technician | supervisor
    const s = state.get(ctx.from.id);
    if (!s || s.flow !== 'join' || s.step !== 2) {
      return ctx.answerCbQuery('الجلسة انتهت، ارسل /start مجددًا', { show_alert: true });
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
      const facility = await prisma.facility.findUnique({ where: { id: s.facilityId } });
      await ctx.editMessageText(
`📝 *تم استلام طلب الانضمام*
—  
المنشأة: ${facility?.name}
الدور المطلوب: ${role}
الحالة: ⏳ pending (بانتظار موافقة المسؤول)`, { parse_mode: 'Markdown' }
      );
      if (process.env.MASTER_ID) {
        try {
          await bot.telegram.sendMessage(
            process.env.MASTER_ID,
            `🔔 طلب انضمام:\n• user ${tgId.toString()} → ${facility?.name}\n• role: ${role}\n• req#${req.id.toString()}`
          );
        } catch {}
      }
    } catch (e) {
      console.error('JOIN_CREATE_REQ_ERROR', e);
      await ctx.answerCbQuery('حدث خطأ أثناء إنشاء الطلب', { show_alert: true });
    }
  });

  // === Master Panel (/master) (NEW) ===
  bot.command('master', async (ctx) => {
    if (!isMaster(ctx)) return ctx.reply('Not allowed');
    const [pf, pr] = await Promise.all([
      prisma.facility.count({ where: { isActive: false } }),
      prisma.facilitySwitchRequest.count({ where: { status: 'pending' } }),
    ]);
    const text = `🛠️ لوحة الماستر\n—\nمنشآت معلّقة: ${pf}\nطلبات انضمام: ${pr}\n\nاختر عملية:`;
    return ctx.reply(text, kb([
      [{ text: '🏢 منشآت معلّقة',           callback_data: 'mf_list' }],
      [{ text: '👥 طلبات انضمام معلّقة',    callback_data: 'mj_list' }]
    ]));
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (!['mf_list','mj_list'].includes(data) && !data.startsWith('mf_') && !data.startsWith('mj_')) return next();
    if (!isMaster(ctx)) return ctx.answerCbQuery('Not allowed', { show_alert: true });

    // منشآت معلّقة
    if (data === 'mf_list') {
      const items = await prisma.facility.findMany({ where: { isActive: false }, take: 10, orderBy: { createdAt: 'asc' } });
      if (!items.length) return ctx.answerCbQuery('لا توجد منشآت معلّقة', { show_alert: true });
      const lines = items.map(f => `• ${f.id.toString()} — ${f.name}`).join('\n');
      await ctx.editMessageText(`🏢 منشآت معلّقة:\n${lines}\n\nاختر منشأة للتفعيل بالخطة:`, kb(
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
      await ctx.answerCbQuery('تم تفعيل المنشأة ✅');
      return ctx.editMessageText(`✅ تم تفعيل المنشأة #${fidStr} على الخطة: ${plan}`);
    }

    // طلبات انضمام معلّقة
    if (data === 'mj_list') {
      const reqs = await prisma.facilitySwitchRequest.findMany({
        where: { status: 'pending' }, take: 10, orderBy: { createdAt: 'asc' }
      });
      if (!reqs.length) return ctx.answerCbQuery('لا توجد طلبات معلّقة', { show_alert: true });
      const lines = await Promise.all(reqs.map(async r => {
        const u = await prisma.user.findUnique({ where: { id: r.userId } });
        const f = r.toFacilityId ? await prisma.facility.findUnique({ where: { id: r.toFacilityId } }) : null;
        return `• req#${r.id.toString()} — tg:${u?.tgId?.toString() ?? '?'} → ${f?.name ?? '?'}`
      }));
      await ctx.editMessageText(
        `👥 طلبات انضمام معلّقة:\n${lines.join('\n')}\n\nاختر الإجراء:`,
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
      if (!req) return ctx.answerCbQuery('غير موجود', { show_alert: true });
      const user = await prisma.user.findUnique({ where: { id: req.userId } });
      if (!user) return ctx.answerCbQuery('User مفقود', { show_alert: true });
      const role = user.requestedRole || 'user';
      await prisma.facilityMember.upsert({
        where: { userId_facilityId: { userId: user.id, facilityId: req.toFacilityId } },
        create: { userId: user.id, facilityId: req.toFacilityId, role },
        update: { role }
      });
      await prisma.user.update({ where: { id: user.id }, data: { status: 'active', activeFacilityId: req.toFacilityId } });
      await prisma.facilitySwitchRequest.update({ where: { id: req.id }, data: { status: 'approved' } });
      if (user.tgId) { try { await bot.telegram.sendMessage(user.tgId.toString(), `✅ تم قبول طلب انضمامك.`); } catch {} }
      await ctx.answerCbQuery('تمت الموافقة ✅');
      return ctx.editMessageText(`✅ Approved req #${rid.toString()}`);
    }
    if (data.startsWith('mj_den_')) {
      const rid = BigInt(data.replace('mj_den_', ''));
      const req = await prisma.facilitySwitchRequest.findUnique({ where: { id: rid } });
      if (!req) return ctx.answerCbQuery('غير موجود', { show_alert: true });
      await prisma.facilitySwitchRequest.update({ where: { id: rid }, data: { status: 'rejected' } });
      const user = await prisma.user.findUnique({ where: { id: req.userId } });
      if (user?.tgId) { try { await bot.telegram.sendMessage(user.tgId.toString(), `⛔ تم رفض طلب انضمامك.`); } catch {} }
      await ctx.answerCbQuery('تم الرفض');
      return ctx.editMessageText(`⛔ Denied req #${rid.toString()}`);
    }
  });

  // تثبيت الويبهوك
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

