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
  } = require('./middleware');

  // Import utilities
  const SecurityManager = require('./utils/security');
  const FlowManager = require('./utils/flowManager');
  const ErrorHandler = require('./utils/errorHandler');

  // ===== MIDDLEWARE SETUP =====
  bot.use(handleRegistrationFlow);
  bot.use(rateLimit());
  bot.use(authenticateUser);

  // ===== COMMAND HANDLERS =====
  bot.command('start', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      const user = await SecurityManager.authenticateUser(ctx.from.id);
      if (!user) return;
      await UserController.showMainMenu(ctx, user);
    }, ctx);
  });

  // ===== ACTION HANDLERS =====
  // Main menu actions
  bot.action('back_to_menu', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      const user = await SecurityManager.authenticateUser(ctx.from.id);
      if (!user) return;
      await UserController.showMainMenu(ctx, user);
    }, ctx);
  });

  // User registration
  bot.action('register_user', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      await UserController.startUserRegistration(ctx, 'user');
    }, ctx);
  });

  bot.action('register_technician', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      await UserController.startUserRegistration(ctx, 'technician');
    }, ctx);
  });

  bot.action('register_supervisor', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      await UserController.startUserRegistration(ctx, 'supervisor');
    }, ctx);
  });

  // Facility management
  bot.action('facility_registration', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      await FacilityController.startFacilityRegistration(ctx);
    }, ctx);
  });

  bot.action('facility_dashboard', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      await FacilityController.showFacilityDashboard(ctx);
    }, ctx);
  });

  // Work orders
  bot.action('wo_new', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      await WorkOrderController.startWorkOrderCreation(ctx);
    }, ctx);
  });

  bot.action('wo_list', async (ctx) => {
    await ErrorHandler.safeExecute(async () => {
      await WorkOrderController.showWorkOrders(ctx);
    }, ctx);
  });

  // ===== TEXT MESSAGE HANDLERS =====
  bot.on('text', async (ctx) => {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const flowState = FlowManager.getFlow(userId);
      if (!flowState) return;

      // Apply flow-specific middleware
      await validateFlowData(ctx, async () => {
        await validateFlowStepInput(ctx, async () => {
          // Route to appropriate controller based on flow type
          switch (flowState.flow) {
            case 'user_registration':
              await UserController.handleUserRegistrationStep(ctx, flowState.step, ctx.sanitizedText);
              break;
            case 'facility_registration':
              await FacilityController.handleFacilityRegistrationStep(ctx, flowState.step, ctx.sanitizedText);
              break;
            case 'wo_new':
              await WorkOrderController.handleWorkOrderStep(ctx, flowState.step, ctx.sanitizedText);
              break;
            case 'reminder_creation':
              await handleReminderCreationStep(ctx, flowState.step, ctx.sanitizedText);
              break;
            default:
              await ctx.reply('❌ Unknown flow type. Please start over.');
              FlowManager.clearFlow(userId);
          }
        });
      });
    } catch (error) {
      ErrorHandler.handleError(ctx, error, 'text_message_handler');
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
    _bot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: 9000 });
    wire(_bot);
    global.__FFB_BOT__ = _bot;
    console.log('🤖 Bot initialized as singleton');
  }
  return _bot;
}

module.exports = { getBot };
