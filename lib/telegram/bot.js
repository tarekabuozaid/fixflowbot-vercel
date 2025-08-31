'use strict';

const { Telegraf } = require('telegraf');

let _bot = global.__FFB_BOT__ || null;

function wire(bot) {
  // Import Controllers
  const UserController = require('./controllers/userController');
  const FacilityController = require('./controllers/facilityController');
  const WorkOrderController = require('./controllers/workOrderController');

  // Import Middleware
  const {
    authenticateUser,
    requireActiveFacility,
    requireMasterAccess,
    handleRegistrationFlow,
    rateLimit,
    workOrderRateLimit,
    facilityRateLimit,
    validateFlowData,
    validateFlowStepInput
  } = require('./middleware/index');

  // Import utilities
  const SecurityManager = require('./utils/security');
  const FlowManager = require('./utils/flowManager');
  const ErrorHandler = require('./utils/errorHandler');

  // Auth wrapper to reduce code duplication
  const withAuth = (handler) => async (ctx) => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) {
        return ctx.reply('❌ Authentication failed. Please try again.');
      }

      const authResult = await SecurityManager.authenticateUser(ctx);
      if (!authResult || !authResult.user) {
        return ctx.reply('❌ Failed to authenticate user. Please try again.');
      }

      ctx.state = ctx.state || {};
      ctx.state.user = authResult.user;
      
      return handler(ctx, authResult.user);
    } catch (error) {
      console.error('Auth wrapper error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  };

  // ===== MIDDLEWARE SETUP =====
  // Note: We'll handle authentication in individual handlers instead of global middleware
  // to avoid issues with the middleware signature

  // ===== COMMAND HANDLERS =====
  bot.command('start', withAuth(async (ctx, user) => {
    console.log('🤖 /start command received from:', ctx.from?.id);
    await UserController.showMainMenu(ctx, user);
  }));

  // Test command for debugging
  bot.command('test', async (ctx) => {
    console.log('🧪 Test command received from:', ctx.from?.id);
    await ctx.reply('✅ Bot is working! Test successful.');
  });

  // ===== ACTION HANDLERS =====
  // Main menu actions
  bot.action('back_to_menu', withAuth(async (ctx, user) => {
    await UserController.showMainMenu(ctx, user);
  }));

  // User registration
  bot.action('register_user', withAuth(async (ctx, user) => {
    await UserController.startUserRegistration(ctx, 'user');
  }));

  bot.action('register_technician', withAuth(async (ctx, user) => {
    await UserController.startUserRegistration(ctx, 'technician');
  }));

  bot.action('register_supervisor', withAuth(async (ctx, user) => {
    await UserController.startUserRegistration(ctx, 'supervisor');
  }));

  // Facility management
  bot.action('facility_registration', withAuth(async (ctx, user) => {
    await FacilityController.startFacilityRegistration(ctx);
  }));

  bot.action('facility_dashboard', withAuth(async (ctx, user) => {
    await FacilityController.showFacilityDashboard(ctx);
  }));

  // Work orders
  bot.action('wo_new', withAuth(async (ctx, user) => {
    await WorkOrderController.startWorkOrderCreation(ctx);
  }));

  bot.action('wo_list', withAuth(async (ctx, user) => {
    await WorkOrderController.showWorkOrders(ctx);
  }));

  // ===== TEXT MESSAGE HANDLERS =====
  bot.on('text', async (ctx) => {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      console.log('📝 Text message received from:', userId, 'Text:', ctx.message?.text?.substring(0, 50));

      const flowState = FlowManager.getFlow(userId);
      if (!flowState) {
        console.log('📝 No active flow for user:', userId);
        return;
      }

      console.log('📝 Processing flow:', flowState.flow, 'Step:', flowState.step);

      // Route to appropriate controller based on flow type
      switch (flowState.flow) {
        case 'user_registration':
          await UserController.handleUserRegistrationStep(ctx, flowState.step, ctx.message.text);
          break;
        case 'facility_registration':
          await FacilityController.handleFacilityRegistrationStep(ctx, flowState.step, ctx.message.text);
          break;
        case 'wo_new':
          await WorkOrderController.handleWorkOrderStep(ctx, flowState.step, ctx.message.text);
          break;
        case 'reminder_creation':
          await handleReminderCreationStep(ctx, flowState.step, ctx.message.text);
          break;
        default:
          await ctx.reply('❌ Unknown flow type. Please start over.');
          FlowManager.clearFlow(userId);
      }
    } catch (error) {
      console.error('Text message handler error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  });

  // ===== ERROR HANDLING =====
  bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ErrorHandler.handleError(ctx, err, 'global_error');
  });

  // ===== REMINDER CREATION HANDLER =====
  async function handleReminderCreationStep(ctx, step, text) {
    const userId = ctx.from.id.toString();
    const flowState = FlowManager.getFlow(userId);
    
    if (!flowState) {
      return ctx.reply('❌ Session expired. Please start over.');
    }

    try {
      switch (step) {
        case 1: // Title
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(userId);
            return ctx.reply('❌ تم إلغاء إنشاء التذكير.', {
              reply_markup: {
                inline_keyboard: [[{ text: '🔙 العودة لإدارة التذكيرات', callback_data: 'reminders' }]]
              }
            });
          }

          const sanitizedTitle = SecurityManager.sanitizeInput(text, 100);
          if (sanitizedTitle.length < 3) {
            return ctx.reply('⚠️ يجب أن يكون العنوان 3 أحرف على الأقل. حاول مرة أخرى أو اكتب /cancel للإلغاء:');
          }

          flowState.data.title = sanitizedTitle;
          flowState.step = 2;
          FlowManager.updateStep(userId, 2);
          FlowManager.updateData(userId, { title: sanitizedTitle });

          await ctx.reply('📅 أدخل تاريخ التذكير (YYYY-MM-DD):', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ إلغاء', callback_data: 'reminders' }]
              ]
            }
          });
          break;

        case 2: // Date
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(userId);
            return ctx.reply('❌ تم إلغاء إنشاء التذكير.', {
              reply_markup: {
                inline_keyboard: [[{ text: '🔙 العودة لإدارة التذكيرات', callback_data: 'reminders' }]]
              }
            });
          }

          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(text)) {
            return ctx.reply('⚠️ يرجى إدخال التاريخ بالتنسيق الصحيح (YYYY-MM-DD). حاول مرة أخرى أو اكتب /cancel للإلغاء:');
          }

          const dueDate = new Date(text);
          if (isNaN(dueDate.getTime()) || dueDate < new Date()) {
            return ctx.reply('⚠️ يرجى إدخال تاريخ صحيح في المستقبل. حاول مرة أخرى أو اكتب /cancel للإلغاء:');
          }

          flowState.data.dueDate = dueDate;
          flowState.step = 3;
          FlowManager.updateStep(userId, 3);
          FlowManager.updateData(userId, { dueDate });

          await ctx.reply('📝 أدخل وصف التذكير (اختياري):', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '⏭️ تخطي', callback_data: 'reminder_skip_description' }],
                [{ text: '❌ إلغاء', callback_data: 'reminders' }]
              ]
            }
          });
          break;

        case 3: // Description
          if (text.toLowerCase() === '/cancel') {
            FlowManager.clearFlow(userId);
            return ctx.reply('❌ تم إلغاء إنشاء التذكير.', {
              reply_markup: {
                inline_keyboard: [[{ text: '🔙 العودة لإدارة التذكيرات', callback_data: 'reminders' }]]
              }
            });
          }

          const sanitizedDescription = SecurityManager.sanitizeInput(text, 500);
          flowState.data.description = sanitizedDescription;
          
          // Create the reminder
          const user = await SecurityManager.authenticateUser(ctx.from.id);
          const { PrismaClient } = require('@prisma/client');
          const prisma = new PrismaClient();
          const membership = await prisma.facilityMember.findFirst({
            where: { userId: user.id, isActive: true }
          });

          const reminderData = {
            title: flowState.data.title,
            description: sanitizedDescription,
            dueDate: flowState.data.dueDate,
            userId: user.id,
            type: 'personal',
            isActive: true
          };

          if (membership) {
            reminderData.facilityId = membership.facilityId;
            reminderData.type = 'facility';
          }

          await prisma.reminder.create({
            data: reminderData
          });

          await prisma.$disconnect();
          FlowManager.clearFlow(userId);

          await ctx.reply('✅ تم إنشاء التذكير بنجاح!', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 العودة لإدارة التذكيرات', callback_data: 'reminders' }]
              ]
            }
          });
          break;

        default:
          FlowManager.clearFlow(userId);
          await ctx.reply('❌ خطأ في تدفق إنشاء التذكير. يرجى المحاولة مرة أخرى.');
      }
    } catch (error) {
      console.error('Reminder creation error:', error);
      FlowManager.clearFlow(userId);
      await ctx.reply('❌ حدث خطأ أثناء إنشاء التذكير. يرجى المحاولة مرة أخرى.');
    }
  }
}

function getBot() {
  if (!_bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN/BOT_TOKEN');
    
    _bot = new Telegraf(token, { 
      telegram: { webhookReply: false }, 
      handlerTimeout: 9000 
    });
    wire(_bot);
    global.__FFB_BOT__ = _bot;
    console.log('🤖 Bot initialized as singleton');
  }
  return _bot;
}

module.exports = { getBot };
