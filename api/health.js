module.exports = (req, res) => {
  // مسار صحّة بسيط لإعادة حالة التطبيق
  res.status(200).json({ ok: true, ts: Date.now() });
};