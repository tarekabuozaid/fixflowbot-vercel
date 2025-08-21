// api/health.js
// مسار صحّة بسيط يعيد حالة الخدمة
module.exports = (req, res) => {
  res.status(200).json({ ok: true, route: '/api/health', ts: Date.now() });
};
// تحديد runtime على Vercel (Node 20)
module.exports.config = { runtime: 'nodejs20' };