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
    await ctx.reply('📝 Please describe the issue (work order description):');
  } catch (e) {
    await ctx.reply('⚠️ You must be an active member of a facility to create a work order.');
  }
});

bot.action('wo_list', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const { user } = await requireActiveMembership(ctx);
    const wos = await prisma.workOrder.findMany({
      where: { facilityId: user.activeFacilityId, createdByUserId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    if (!wos.length) {
      return ctx.reply('🔍 No work orders found.');
    }
    const lines = wos.map(wo => `#${wo.id.toString()} — ${wo.status} — ${wo.description.slice(0, 50)}`);
    await ctx.reply(lines.join('\n'));
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
      if (flowState.step === 1) {
        const desc = text.slice(0, 500);
        const { user } = await requireActiveMembership(ctx);
        const wo = await prisma.workOrder.create({
          data: {
            facilityId: user.activeFacilityId,
            createdByUserId: user.id,
            description: desc,
            status: 'open'
          }
        });
        flows.delete(ctx.from.id);
        await ctx.reply(`✅ Work order created: #${wo.id.toString()}`);
        return;
      }
    }
  } catch (e) {
    console.error('FLOW_ERROR', e);
    flows.delete(ctx.from.id);
    return ctx.reply('⚠️ An error occurred. Please try again.');
  }
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
