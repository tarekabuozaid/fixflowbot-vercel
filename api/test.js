module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    message: 'Test endpoint working',
    timestamp: new Date().toISOString()
  });
};
