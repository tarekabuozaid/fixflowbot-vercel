'use strict';

module.exports = async (req, res) => {
  try {
    console.log('🔍 Webhook endpoint called');
    console.log('Method:', req.method);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    // Always return 200 for now
    res.status(200).json({
      ok: true,
      message: 'Webhook endpoint working',
      method: req.method,
      timestamp: new Date().toISOString()
    });
    
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(200).json({
      ok: false,
      error: e.message,
      timestamp: new Date().toISOString()
    });
  }
};
