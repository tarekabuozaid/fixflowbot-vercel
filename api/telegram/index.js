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

  // رسالة ترحيب بسيطة
  bot.start((ctx) => ctx.reply('FixFlowBot جاهز — اكتب /ping للتجربة، و /me لعرض بياناتك'));

  // رد عام يفيد إن البوت Online
  bot.on('message', (ctx) => {
    if (!ctx.message.text?.startsWith('/')) {
      ctx.reply('👋 bot online — اكتب /ping للتجربة أو /me لعرض بياناتك');
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

