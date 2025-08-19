module.exports = (req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
};
module.exports.config = { runtime: 'nodejs20.x' };
