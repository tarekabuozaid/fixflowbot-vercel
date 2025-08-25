import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, userId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Simple message processing
    const lowerMessage = message.toLowerCase();
    let response = '';

    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
      response = 'Hello! Welcome to FixFlow. How can I help you today?';
    } else if (lowerMessage.includes('work order') || lowerMessage.includes('issue')) {
      response = 'To create a work order, please use our Telegram bot or visit the dashboard. You can also describe your issue here and I\'ll help you get started.';
    } else if (lowerMessage.includes('statistics') || lowerMessage.includes('stats')) {
      response = 'You can view your statistics in the dashboard or use the Telegram bot. What specific information are you looking for?';
    } else if (lowerMessage.includes('help')) {
      response = 'I can help you with:\n• Creating work orders\n• Checking statistics\n• Managing facilities\n• Team coordination\n\nTry asking about any of these topics!';
    } else if (lowerMessage.includes('facility') || lowerMessage.includes('building')) {
      response = 'Facility management is available through our dashboard. You can register new facilities, manage members, and track maintenance activities.';
    } else {
      response = 'Thank you for your message! For the best experience, I recommend using our Telegram bot (@fixflowbot) or visiting the dashboard for full functionality.';
    }

    // Log the interaction
    try {
      await prisma.chatLog.create({
        data: {
          message: message,
          response: response,
          source: 'web',
          userId: userId || null,
          timestamp: new Date()
        }
      });
    } catch (logError) {
      console.error('Failed to log chat:', logError);
      // Don't fail the request if logging fails
    }

    res.status(200).json({ response });
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      response: 'Sorry, I\'m having trouble processing your request. Please try again later.'
    });
  }
}
