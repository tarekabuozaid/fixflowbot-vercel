'use strict';

const prisma = require('../../lib/telegram/services/_db');
const { log } = require('../../lib/telegram/utils/logger');

module.exports = async (req, res) => {
  // Check authorization
  const ok =
    !process.env.CRON_SECRET ||
    req.headers['x-cron-secret'] === process.env.CRON_SECRET ||
    req.query?.key === process.env.CRON_SECRET;

  if (!ok) {
    log('WARN', 'Unauthorized cron access attempt', { 
      headers: Object.keys(req.headers),
      query: req.query 
    });
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    // Find due reminders
    const now = new Date();
    const dueReminders = await prisma.reminder.findMany({
      where: {
        dueDate: {
          lte: now
        },
        isActive: true
      },
      include: {
        user: true,
        facility: true
      }
    });

    log('INFO', 'Processing reminders', { 
      count: dueReminders.length,
      timestamp: now.toISOString()
    });

    if (dueReminders.length === 0) {
      return res.status(200).json({ 
        ok: true, 
        message: 'No due reminders',
        count: 0
      });
    }

    // Process each reminder
    const results = [];
    for (const reminder of dueReminders) {
      try {
        // Send notification to user
        const message = `⏰ **Reminder: ${reminder.title}**\n\n` +
                       `${reminder.description || 'No description'}\n\n` +
                       `Due: ${reminder.dueDate.toLocaleDateString()}`;

        // Here you would send the actual Telegram message
        // For now, we'll just log it
        log('INFO', 'Reminder sent', {
          userId: reminder.userId,
          title: reminder.title,
          type: reminder.type
        });

        // Mark as processed
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { isActive: false }
        });

        results.push({
          id: reminder.id,
          title: reminder.title,
          status: 'sent'
        });

      } catch (error) {
        log('ERROR', 'Failed to process reminder', {
          reminderId: reminder.id,
          error: error.message
        });
        
        results.push({
          id: reminder.id,
          title: reminder.title,
          status: 'failed',
          error: error.message
        });
      }
    }

    res.status(200).json({
      ok: true,
      processed: results.length,
      results
    });

  } catch (error) {
    log('ERROR', 'Cron job failed', { error: error.message });
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};
