// api/telegram/index.js (Node.js, CommonJS)
// ملاحظة: احفظ الملف UTF-8 بدون BOM.
const { PrismaClient } = require('@prisma/client');
const https = require('https');

const g = globalThis;
const prisma = g._prisma ?? new PrismaClient();
if (!g._prisma) g._prisma = prisma;

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ID = process.env.MASTER_ID;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendMessage(chat_id, text, extra = {}) {
  return fetchJson(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, ...extra }),
  });
}

function fetchJson(url, opts) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { method: opts?.method || 'GET', hostname: u.hostname, path: u.pathname + (u.search || ''), headers: opts?.headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
        });
      }
    );
    req.on('error', reject);
    if (opts?.body) req.write(opts.body);
    req.end();
  });
}

async function upsertUserFromMessage(msg) {
  const tgId = msg?.from?.id?.toString();
  if (!tgId) return null;

  const firstName = msg.from.first_name || null;
  const username  = msg.from.username || null;

  // upsert مستخدم. لو مش موجود → pending افتراضيًا
  return prisma.user.upsert({
    where: { tgId },
    update: {
      firstName,
      username,
    },
    create: {
      tgId,
      firstName,
      username,
      status: 'pending', // يتفعّل لاحقًا
    },
  });
}

function isAdmin(tgId) {
  if (!MASTER_ID) return false;
  return tgId?.toString() === MASTER_ID?.toString();
}

module.exports = async (req, res) => {
  // ردّ فوري لتفادي 500/timeout
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, health: 'telegram webhook alive' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let update;
  try {
    update = await readJson(req);
  } catch (e) {
    console.error('PARSE_ERROR', e);
    return res.status(200).json({ ok: true }); // لا ترجع 500 لتلغرام
  }

  // رجّع OK فورًا ثم كمّل المعالجة في الخلفية
  res.status(200).json({ ok: true });

  try {
    const msg  = update?.message;
    const text = msg?.text?.trim() || '';
    const chatId = msg?.chat?.id;

    if (!BOT_TOKEN || !chatId || !msg) return;

    // upsert user
    const user = await upsertUserFromMessage(msg);
    const tgId = msg.from.id.toString();

    // أوامر عامة لا تتطلب تفعيل
    if (text === '/ping') {
      await sendMessage(chatId, 'pong ✅');
      return;
    }

    if (text === '/start') {
      if (user.status === 'pending') {
        await sendMessage(chatId, '👋 أهلاً! تم تسجيلك كـ pending.\nسيتم تفعيلك بواسطة المسؤول قريبًا.');
      } else {
        await sendMessage(chatId, 'مرحباً! حسابك مُفعّل ✅. اكتب /me لعرض حالتك.');
      }
      return;
    }

    // أمر موافقة بسيط (للأدمن فقط): /approve <tgId>
    if (text.startsWith('/approve')) {
      if (!isAdmin(tgId)) {
        await sendMessage(chatId, '❌ ليس لديك صلاحية هذا الأمر.');
        return;
      }
      const parts = text.split(/\s+/);
      const approveId = parts[1]?.trim();
      if (!approveId) {
        await sendMessage(chatId, 'استخدم: /approve <tgId>');
        return;
      }
      await prisma.user.update({
        where: { tgId: approveId },
        data: { status: 'active' },
      });
      await sendMessage(chatId, `تم تفعيل المستخدم ${approveId} ✅`);
      return;
    }

    // بوابة pending: امنع أي أوامر غير عامة
    if (user.status !== 'active') {
      await sendMessage(chatId, 'حسابك قيد الموافقة ⏳. تواصل مع المسؤول للتفعيل.');
      return;
    }

    // /me – معلومات سريعة عن حسابك ومنشأتك (لو موجودة)
    if (text === '/me') {
      // لو عندك FacilityMember و activeFacility… ضيفها هنا
      const facilitiesCount = await prisma.facilityMember.count({ where: { userId: user.id } }).catch(() => 0);
      await sendMessage(
        chatId,
        `حالتك: ${user.status}\nمنشآت مرتبطة: ${facilitiesCount}`
      );
      return;
    }

    // TODO: أوامر WO الأساسية (#wo, /wo_new, /wo_list, /wo_status…) هانضيفها بعد ما نتأكد من الحقول الإلزامية في المخطط.
    // مكانها هنا.

  } catch (err) {
    console.error('WEBHOOK_ERROR', err);
    // ما نرسلش رد هنا (ردينا بالفعل 200 فوق)
  }
};

module.exports.config = { runtime: 'nodejs20', maxDuration: 10 }
