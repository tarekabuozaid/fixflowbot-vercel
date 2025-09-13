/**
 * Enhanced Work Order Controller - تحكم محسن في طلبات الصيانة
 * 
 * هذا الملف يحتوي على تحكم محسن في طلبات الصيانة يستخدم SmartFlowManager:
 * - تدفق ذكي مع شريط التقدم
 * - حفظ البيانات المؤقتة
 * - إمكانية العودة للخطوات السابقة
 * - تحقق من صحة البيانات
 * - إشعارات للمستخدم
 * - إلغاء العملية في أي وقت
 */

const { Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

// Import utilities
const SecurityManager = require('../utils/security');
const SmartFlowManager = require('../utils/smartFlowManager');
const PlanManager = require('../utils/planManager');
const ErrorHandler = require('../utils/errorHandler');

const prisma = new PrismaClient();

class EnhancedWorkOrderController {
  
  /**
   * بدء إنشاء طلب صيانة محسن
   */
  static async startEnhancedWorkOrderCreation(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      if (!user.activeFacilityId) {
        return ctx.reply(
          '❌ **No Active Facility**\n\n' +
          'You need to be connected to a facility to create work orders.\n\n' +
          'Please join a facility first.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback('🏢 Register Facility', 'reg_fac_start')],
                [Markup.button.callback('🔗 Join Facility', 'join_fac_start')],
                [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
              ]
            }
          }
        );
      }

      // التحقق من حدود الخطة
      await PlanManager.checkPlanLimit(user.activeFacilityId.toString(), 'workOrders', 1);

      // بدء التدفق الذكي
      const flowConfig = {
        totalSteps: 6,
        title: 'Work Order Creation',
        description: 'Create a new maintenance work order',
        allowBack: true,
        allowCancel: true,
        showProgress: true
      };

      await SmartFlowManager.startSmartFlow(
        user.tgId.toString(), 
        'wo_enhanced', 
        {
          facilityId: user.activeFacilityId.toString(),
          userId: user.tgId.toString()
        },
        flowConfig
      );

      // إرسال إشعار
      await SmartFlowManager.sendNotification(
        ctx, 
        'Work order creation started! You can go back or cancel at any time.', 
        'info'
      );

      // عرض الخطوة الأولى
      await this.showWorkOrderStep(ctx, 1);
      
    }, ctx, 'start_enhanced_work_order_creation');
  }

  /**
   * عرض خطوة من خطوات إنشاء طلب الصيانة
   */
  static async showWorkOrderStep(ctx, step) {
    const flow = await SmartFlowManager.getFlow(ctx.from.id.toString());
    if (!flow) {
      return ctx.reply('⚠️ No active work order creation found.');
    }

    const progressBar = SmartFlowManager.getProgressBar(step, flow.totalSteps);
    
    switch (step) {
      case 1:
        await this.showWorkTypeSelection(ctx, flow);
        break;
      case 2:
        await this.showServiceTypeSelection(ctx, flow);
        break;
      case 3:
        await this.showPrioritySelection(ctx, flow);
        break;
      case 4:
        await this.showLocationInput(ctx, flow);
        break;
      case 5:
        await this.showEquipmentInput(ctx, flow);
        break;
      case 6:
        await this.showDescriptionInput(ctx, flow);
        break;
      default:
        await ctx.reply('⚠️ Invalid step.');
    }
  }

  /**
   * عرض اختيار نوع العمل
   */
  static async showWorkTypeSelection(ctx, flow) {
    const progressBar = SmartFlowManager.getProgressBar(1, flow.totalSteps);
    
    await ctx.reply(
      `🔧 **Work Order Creation (1/6)**\n\n` +
      `📊 Progress: ${progressBar}\n\n` +
      `Choose the type of work:\n\n` +
      `Select the category that best describes the work needed:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔧 Maintenance', 'wo_enhanced_type|maintenance')],
            [Markup.button.callback('🔨 Repair', 'wo_enhanced_type|repair')],
            [Markup.button.callback('⚙️ Installation', 'wo_enhanced_type|installation')],
            [Markup.button.callback('🧹 Cleaning', 'wo_enhanced_type|cleaning')],
            [Markup.button.callback('🔍 Inspection', 'wo_enhanced_type|inspection')],
            [Markup.button.callback('📝 Other', 'wo_enhanced_type|other')],
            [Markup.button.callback('❌ Cancel', 'wo_enhanced_cancel')]
          ]
        }
      }
    );
  }

  /**
   * عرض اختيار نوع الخدمة
   */
  static async showServiceTypeSelection(ctx, flow) {
    const progressBar = SmartFlowManager.getProgressBar(2, flow.totalSteps);
    
    await ctx.editMessageText(
      `🔧 **Work Order Creation (2/6)**\n\n` +
      `📊 Progress: ${progressBar}\n\n` +
      `✅ **Type:** ${flow.data.typeOfWork}\n\n` +
      `Choose the service type:\n\n` +
      `Select the type of service needed:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔍 Preventive', 'wo_enhanced_service|preventive')],
            [Markup.button.callback('🚨 Corrective', 'wo_enhanced_service|corrective')],
            [Markup.button.callback('⚡ Emergency', 'wo_enhanced_service|emergency')],
            [Markup.button.callback('🔧 Routine', 'wo_enhanced_service|routine')],
            [Markup.button.callback('📋 Inspection', 'wo_enhanced_service|inspection')],
            [Markup.button.callback('⬅️ Back', 'wo_enhanced_back')],
            [Markup.button.callback('❌ Cancel', 'wo_enhanced_cancel')]
          ]
        }
      }
    );
  }

  /**
   * عرض اختيار الأولوية
   */
  static async showPrioritySelection(ctx, flow) {
    const progressBar = SmartFlowManager.getProgressBar(3, flow.totalSteps);
    
    await ctx.editMessageText(
      `🔧 **Work Order Creation (3/6)**\n\n` +
      `📊 Progress: ${progressBar}\n\n` +
      `✅ **Type:** ${flow.data.typeOfWork}\n` +
      `✅ **Service:** ${flow.data.typeOfService}\n\n` +
      `Choose the priority level:\n\n` +
      `Select how urgent this work is:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔴 High', 'wo_enhanced_priority|high')],
            [Markup.button.callback('🟡 Medium', 'wo_enhanced_priority|medium')],
            [Markup.button.callback('🟢 Low', 'wo_enhanced_priority|low')],
            [Markup.button.callback('⬅️ Back', 'wo_enhanced_back')],
            [Markup.button.callback('❌ Cancel', 'wo_enhanced_cancel')]
          ]
        }
      }
    );
  }

  /**
   * عرض إدخال الموقع
   */
  static async showLocationInput(ctx, flow) {
    const progressBar = SmartFlowManager.getProgressBar(4, flow.totalSteps);
    
    await ctx.editMessageText(
      `🔧 **Work Order Creation (4/6)**\n\n` +
      `📊 Progress: ${progressBar}\n\n` +
      `✅ **Type:** ${flow.data.typeOfWork}\n` +
      `✅ **Service:** ${flow.data.typeOfService}\n` +
      `✅ **Priority:** ${flow.data.priority}\n\n` +
      `📍 **Enter the location**\n\n` +
      `Where is this work needed?\n` +
      `(e.g., Building A - Floor 2, Room 205)`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('⬅️ Back', 'wo_enhanced_back')],
            [Markup.button.callback('❌ Cancel', 'wo_enhanced_cancel')]
          ]
        }
      }
    );
  }

  /**
   * عرض إدخال المعدات
   */
  static async showEquipmentInput(ctx, flow) {
    const progressBar = SmartFlowManager.getProgressBar(5, flow.totalSteps);
    
    await ctx.editMessageText(
      `🔧 **Work Order Creation (5/6)**\n\n` +
      `📊 Progress: ${progressBar}\n\n` +
      `✅ **Type:** ${flow.data.typeOfWork}\n` +
      `✅ **Service:** ${flow.data.typeOfService}\n` +
      `✅ **Priority:** ${flow.data.priority}\n` +
      `✅ **Location:** ${flow.data.location}\n\n` +
      `🔧 **Enter equipment details (optional)**\n\n` +
      `What equipment is involved?\n` +
      `(e.g., HVAC Unit #5, Electrical Panel B)\n\n` +
      `Type /skip to skip this step`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('⏭️ Skip', 'wo_enhanced_skip')],
            [Markup.button.callback('⬅️ Back', 'wo_enhanced_back')],
            [Markup.button.callback('❌ Cancel', 'wo_enhanced_cancel')]
          ]
        }
      }
    );
  }

  /**
   * عرض إدخال الوصف
   */
  static async showDescriptionInput(ctx, flow) {
    const progressBar = SmartFlowManager.getProgressBar(6, flow.totalSteps);
    
    await ctx.editMessageText(
      `🔧 **Work Order Creation (6/6)**\n\n` +
      `📊 Progress: ${progressBar}\n\n` +
      `✅ **Type:** ${flow.data.typeOfWork}\n` +
      `✅ **Service:** ${flow.data.typeOfService}\n` +
      `✅ **Priority:** ${flow.data.priority}\n` +
      `✅ **Location:** ${flow.data.location}\n` +
      `✅ **Equipment:** ${flow.data.equipment || 'Not specified'}\n\n` +
      `📝 **Enter detailed description**\n\n` +
      `Please provide a detailed description of the work needed:\n` +
      `(Minimum 10 characters)`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('⬅️ Back', 'wo_enhanced_back')],
            [Markup.button.callback('❌ Cancel', 'wo_enhanced_cancel')]
          ]
        }
      }
    );
  }

  /**
   * معالجة اختيار نوع العمل
   */
  static async handleWorkTypeSelection(ctx, workType) {
    return ErrorHandler.safeExecute(async () => {
      const validation = SmartFlowManager.validateStepData('wo_enhanced', 1, { typeOfWork: workType });
      if (!validation.valid) {
        await SmartFlowManager.sendNotification(ctx, validation.message, 'error');
        return;
      }

      await SmartFlowManager.updateStep(ctx.from.id.toString(), 2, { typeOfWork: workType });
      await SmartFlowManager.sendNotification(ctx, 'Work type selected!', 'success');
      await this.showWorkOrderStep(ctx, 2);
      
    }, ctx, 'handle_work_type_selection');
  }

  /**
   * معالجة اختيار نوع الخدمة
   */
  static async handleServiceTypeSelection(ctx, serviceType) {
    return ErrorHandler.safeExecute(async () => {
      const validation = SmartFlowManager.validateStepData('wo_enhanced', 2, { typeOfService: serviceType });
      if (!validation.valid) {
        await SmartFlowManager.sendNotification(ctx, validation.message, 'error');
        return;
      }

      await SmartFlowManager.updateStep(ctx.from.id.toString(), 3, { typeOfService: serviceType });
      await SmartFlowManager.sendNotification(ctx, 'Service type selected!', 'success');
      await this.showWorkOrderStep(ctx, 3);
      
    }, ctx, 'handle_service_type_selection');
  }

  /**
   * معالجة اختيار الأولوية
   */
  static async handlePrioritySelection(ctx, priority) {
    return ErrorHandler.safeExecute(async () => {
      const validation = SmartFlowManager.validateStepData('wo_enhanced', 3, { priority: priority });
      if (!validation.valid) {
        await SmartFlowManager.sendNotification(ctx, validation.message, 'error');
        return;
      }

      await SmartFlowManager.updateStep(ctx.from.id.toString(), 4, { priority: priority });
      await SmartFlowManager.sendNotification(ctx, 'Priority selected!', 'success');
      await this.showWorkOrderStep(ctx, 4);
      
    }, ctx, 'handle_priority_selection');
  }

  /**
   * معالجة إدخال الموقع
   */
  static async handleLocationInput(ctx, location) {
    return ErrorHandler.safeExecute(async () => {
      const sanitizedLocation = SecurityManager.sanitizeInput(location, 100);
      const validation = SmartFlowManager.validateStepData('wo_enhanced', 4, { location: sanitizedLocation });
      
      if (!validation.valid) {
        await SmartFlowManager.sendNotification(ctx, 'Location must be at least 3 characters long.', 'error');
        return;
      }

      await SmartFlowManager.updateStep(ctx.from.id.toString(), 5, { location: sanitizedLocation });
      await SmartFlowManager.sendNotification(ctx, 'Location saved!', 'success');
      await this.showWorkOrderStep(ctx, 5);
      
    }, ctx, 'handle_location_input');
  }

  /**
   * معالجة إدخال المعدات
   */
  static async handleEquipmentInput(ctx, equipment) {
    return ErrorHandler.safeExecute(async () => {
      const sanitizedEquipment = SecurityManager.sanitizeInput(equipment, 100);
      await SmartFlowManager.updateStep(ctx.from.id.toString(), 6, { equipment: sanitizedEquipment });
      await SmartFlowManager.sendNotification(ctx, 'Equipment details saved!', 'success');
      await this.showWorkOrderStep(ctx, 6);
      
    }, ctx, 'handle_equipment_input');
  }

  /**
   * معالجة إدخال الوصف
   */
  static async handleDescriptionInput(ctx, description) {
    return ErrorHandler.safeExecute(async () => {
      const sanitizedDescription = SecurityManager.sanitizeInput(description, 500);
      const validation = SmartFlowManager.validateStepData('wo_enhanced', 6, { description: sanitizedDescription });
      
      if (!validation.valid) {
        await SmartFlowManager.sendNotification(ctx, 'Description must be at least 10 characters long.', 'error');
        return;
      }

      await SmartFlowManager.updateStep(ctx.from.id.toString(), 6, { description: sanitizedDescription });
      await this.showWorkOrderConfirmation(ctx);
      
    }, ctx, 'handle_description_input');
  }

  /**
   * عرض تأكيد طلب الصيانة
   */
  static async showWorkOrderConfirmation(ctx) {
    const flow = await SmartFlowManager.getFlow(ctx.from.id.toString());
    if (!flow) {
      return ctx.reply('⚠️ No active work order creation found.');
    }

    const data = flow.data;
    
    await ctx.editMessageText(
      `🔧 **Work Order Confirmation**\n\n` +
      `📊 Progress: ${SmartFlowManager.getProgressBar(6, 6)}\n\n` +
      `📋 **Review your work order:**\n\n` +
      `🔧 **Type:** ${data.typeOfWork}\n` +
      `🛠️ **Service:** ${data.typeOfService}\n` +
      `⚡ **Priority:** ${data.priority}\n` +
      `📍 **Location:** ${data.location}\n` +
      `🔧 **Equipment:** ${data.equipment || 'Not specified'}\n` +
      `📝 **Description:** ${data.description}\n\n` +
      `Please review the information above and confirm to create the work order.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('✅ Confirm & Create', 'wo_enhanced_confirm')],
            [Markup.button.callback('✏️ Edit', 'wo_enhanced_edit')],
            [Markup.button.callback('⬅️ Back', 'wo_enhanced_back')],
            [Markup.button.callback('❌ Cancel', 'wo_enhanced_cancel')]
          ]
        }
      }
    );
  }

  /**
   * تأكيد وإنشاء طلب الصيانة
   */
  static async confirmWorkOrderCreation(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      const flow = await SmartFlowManager.getFlow(ctx.from.id.toString());
      
      if (!flow) {
        return ctx.reply('⚠️ No active work order creation found.');
      }

      const data = flow.data;
      
      // إنشاء طلب الصيانة في قاعدة البيانات
      const workOrder = await prisma.workOrder.create({
        data: {
          facilityId: user.activeFacilityId,
          createdByUserId: user.id,
          typeOfWork: data.typeOfWork,
          typeOfService: data.typeOfService,
          priority: data.priority,
          location: data.location,
          equipment: data.equipment,
          description: data.description,
          status: 'open'
        }
      });
      
      // إنهاء التدفق
      await SmartFlowManager.completeFlow(ctx.from.id.toString(), { workOrderId: workOrder.id });
      
      // إرسال إشعار النجاح
      await SmartFlowManager.sendNotification(
        ctx, 
        `Work order #${workOrder.id} created successfully!`, 
        'success'
      );
      
      await ctx.editMessageText(
        `✅ **Work Order Created Successfully!**\n\n` +
        `🆔 **Order ID:** #${workOrder.id.toString()}\n` +
        `📋 **Type:** ${data.typeOfWork}\n` +
        `🛠️ **Service:** ${data.typeOfService}\n` +
        `⚡ **Priority:** ${data.priority}\n` +
        `📍 **Location:** ${data.location}\n` +
        `🔧 **Equipment:** ${data.equipment || 'Not specified'}\n` +
        `📝 **Description:** ${data.description}\n\n` +
        `📅 **Created:** ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}\n` +
        `🔵 **Status:** Open\n\n` +
        `Your work order has been submitted and assigned to the appropriate team.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('📋 View My Orders', 'wo_list')],
              [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
            ]
          }
        }
      );
      
      console.log(`Enhanced work order created successfully: #${workOrder.id.toString()} for user ${ctx.from.id}`);
      
    }, ctx, 'confirm_work_order_creation');
  }

  /**
   * العودة للخطوة السابقة
   */
  static async goBack(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const flow = await SmartFlowManager.getFlow(ctx.from.id.toString());
      if (!flow) {
        return ctx.reply('⚠️ No active work order creation found.');
      }

      if (flow.history.length === 0) {
        await SmartFlowManager.sendNotification(ctx, 'No previous step available.', 'warning');
        return;
      }

      await SmartFlowManager.goBack(ctx.from.id.toString());
      await SmartFlowManager.sendNotification(ctx, 'Returned to previous step.', 'info');
      
      const updatedFlow = await SmartFlowManager.getFlow(ctx.from.id.toString());
      await this.showWorkOrderStep(ctx, updatedFlow.step);
      
    }, ctx, 'go_back');
  }

  /**
   * إلغاء إنشاء طلب الصيانة
   */
  static async cancelWorkOrderCreation(ctx) {
    return ErrorHandler.safeExecute(async () => {
      await SmartFlowManager.cancelFlow(ctx.from.id.toString(), 'User cancelled');
      await SmartFlowManager.sendNotification(ctx, 'Work order creation cancelled.', 'info');
      
      await ctx.editMessageText(
        '❌ **Work Order Creation Cancelled**\n\n' +
        'You can start a new work order creation anytime from the main menu.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
            ]
          }
        }
      );
      
    }, ctx, 'cancel_work_order_creation');
  }
}

module.exports = EnhancedWorkOrderController;
