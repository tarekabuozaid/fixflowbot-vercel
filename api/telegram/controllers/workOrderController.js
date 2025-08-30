/**
 * Work Order Controller - إدارة عمليات البلاغات
 * 
 * هذا الملف يحتوي على جميع العمليات المتعلقة بالبلاغات:
 * - إنشاء بلاغات جديدة
 * - إدارة البلاغات
 * - تتبع الحالة
 * - إدارة الأولويات
 */

const { Markup } = require('telegraf');

// Import Services
const { WorkOrderService, PlanService } = require('../services');

// Import utilities
const SecurityManager = require('../utils/security');
const FlowManager = require('../utils/flowManager');
const ErrorHandler = require('../utils/errorHandler');

class WorkOrderController {
  
  /**
   * بدء إنشاء بلاغ جديد
   */
  static async startWorkOrderCreation(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      if (!user.activeFacilityId) {
        return ctx.reply(
          '❌ You need to be connected to a facility to create work orders.\n\n' +
          'Please join a facility first.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        );
      }

      // التحقق من حدود الخطة باستخدام PlanService
      const planCheck = await PlanService.checkPlanLimit(
        user.activeFacilityId.toString(), 
        'workOrders', 
        1
      );

      if (!planCheck.success) {
        return ctx.reply(`❌ ${planCheck.message}`);
      }

      // التحقق من عدم وجود فلوه نشط
      if (FlowManager.hasActiveFlow(user.tgId.toString())) {
        FlowManager.clearFlow(user.tgId.toString());
      }

      // إنشاء فلوه إنشاء بلاغ جديد
      FlowManager.setFlow(user.tgId.toString(), 'wo_new', 1, {
        facilityId: user.activeFacilityId.toString(),
        userId: user.tgId.toString()
      });

      await ctx.reply(
        '🔧 **Work Order Creation (1/6)**\n\n' +
        'Choose the type of work:\n\n' +
        'Select the category that best describes the work needed:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔧 Maintenance', 'wo_type|maintenance')],
            [Markup.button.callback('🔨 Repair', 'wo_type|repair')],
            [Markup.button.callback('⚙️ Installation', 'wo_type|installation')],
            [Markup.button.callback('🧹 Cleaning', 'wo_type|cleaning')],
            [Markup.button.callback('🔍 Inspection', 'wo_type|inspection')],
            [Markup.button.callback('📝 Other', 'wo_type|other')],
            [Markup.button.callback('❌ Cancel', 'wo_cancel')]
          ])
        }
      );
    }, ctx, 'start_work_order_creation');
  }

  /**
   * معالجة خطوة إنشاء البلاغ
   */
  static async handleWorkOrderStep(ctx, step, input) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      const flowState = FlowManager.getFlow(user.tgId.toString());
      
      if (!flowState || flowState.flow !== 'wo_new') {
        return ctx.reply('❌ No active work order creation found. Please start over.');
      }

      const sanitizedInput = SecurityManager.sanitizeInput(input, 1000);

      switch (step) {
        case 4: // الموقع
          if (!sanitizedInput || sanitizedInput.length < 2 || sanitizedInput.length > 100) {
            return ctx.reply('❌ Invalid location. Please enter a location between 2-100 characters.');
          }
          
          FlowManager.updateData(user.tgId.toString(), { location: sanitizedInput });
          FlowManager.updateStep(user.tgId.toString(), 5);
          
          await ctx.reply(
            '🔧 **Work Order Creation (5/6)**\n\n' +
            'Please enter the equipment (optional):\n\n' +
            'Example: HVAC Unit #5, Elevator 2, Generator A\n' +
            'Or type "skip" to skip this step.',
            Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel', 'wo_cancel')]
            ])
          );
          break;

        case 5: // المعدات
          if (sanitizedInput.toLowerCase() === 'skip') {
            FlowManager.updateData(user.tgId.toString(), { equipment: null });
          } else {
            FlowManager.updateData(user.tgId.toString(), { equipment: sanitizedInput });
          }
          
          FlowManager.updateStep(user.tgId.toString(), 6);
          
          await ctx.reply(
            '🔧 **Work Order Creation (6/6)**\n\n' +
            'Please enter a detailed description:\n\n' +
            'Describe the issue, work needed, or any specific requirements:\n' +
            'Requirements: 10-500 characters',
            Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel', 'wo_cancel')]
            ])
          );
          break;

        case 6: // الوصف
          if (!sanitizedInput || sanitizedInput.length < 10 || sanitizedInput.length > 500) {
            return ctx.reply('❌ Invalid description. Please enter a description between 10-500 characters.');
          }
          
          FlowManager.updateData(user.tgId.toString(), { description: sanitizedInput });
          
          // إنشاء البلاغ باستخدام WorkOrderService
          await this.createWorkOrder(ctx, user, flowState.data);
          break;

        default:
          return ctx.reply('❌ Invalid work order step.');
      }
    }, ctx, 'handle_work_order_step');
  }

  /**
   * إنشاء البلاغ في قاعدة البيانات
   */
  static async createWorkOrder(ctx, user, workOrderData) {
    return ErrorHandler.safeExecute(async () => {
      // التحقق من حدود الخطة مرة أخرى باستخدام PlanService
      const planCheck = await PlanService.checkPlanLimit(
        user.activeFacilityId.toString(), 
        'workOrders', 
        1
      );

      if (!planCheck.success) {
        return ctx.reply(`❌ ${planCheck.message}`);
      }

      // إنشاء البلاغ باستخدام WorkOrderService
      const workOrderResult = await WorkOrderService.createWorkOrder({
        facilityId: user.activeFacilityId.toString(),
        createdByUserId: user.id.toString(),
        typeOfWork: workOrderData.typeOfWork,
        typeOfService: workOrderData.typeOfService,
        priority: workOrderData.priority,
        location: workOrderData.location,
        equipment: workOrderData.equipment,
        description: workOrderData.description
      });

      if (!workOrderResult.success) {
        return ctx.reply('❌ Error creating work order.');
      }

      const workOrder = workOrderResult.workOrder;

      // مسح الفلوه
      FlowManager.clearFlow(user.tgId.toString());

      const priorityEmojis = {
        'high': '🔴',
        'medium': '🟡',
        'low': '🟢'
      };

      const priorityEmoji = priorityEmojis[workOrderData.priority] || '⚪';

      await ctx.reply(
        `✅ **Work Order Created Successfully!**\n\n` +
        `📋 **Work Order #${workOrder.id}**\n\n` +
        `🔧 **Type:** ${workOrderData.typeOfWork}\n` +
        `🛠️ **Service:** ${workOrderData.typeOfService}\n` +
        `${priorityEmoji} **Priority:** ${workOrderData.priority}\n` +
        `📍 **Location:** ${workOrderData.location}\n` +
        `${workOrderData.equipment ? `⚙️ **Equipment:** ${workOrderData.equipment}\n` : ''}` +
        `📝 **Description:** ${workOrderData.description}\n\n` +
        `📅 **Created:** ${new Date().toLocaleString()}\n` +
        `👤 **Created by:** ${user.firstName || 'User'}\n\n` +
        `Your work order has been submitted and is now being reviewed.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 View Work Order', `wo_view|${workOrder.id}`)],
            [Markup.button.callback('➕ Create Another', 'wo_new')],
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        }
      );
    }, ctx, 'create_work_order');
  }

  /**
   * إلغاء إنشاء البلاغ
   */
  static async cancelWorkOrderCreation(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      FlowManager.clearFlow(user.tgId.toString());
      
      await ctx.reply(
        '❌ Work order creation cancelled.\n\n' +
        'You can create a new work order anytime.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
        ])
      );
    }, ctx, 'cancel_work_order_creation');
  }

  /**
   * عرض قائمة البلاغات
   */
  static async showWorkOrders(ctx, filter = 'all') {
    return ErrorHandler.safeExecute(async () => {
      const { user, facility } = await SecurityManager.validateFacilityAccess(
        ctx, 
        null, 
        ['facility_admin', 'supervisor', 'technician', 'user']
      );

      if (!facility) {
        return ctx.reply(
          '❌ No active facility found.\n\n' +
          'Please join a facility first.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        );
      }

      // بناء خيارات البحث
      const options = {};
      if (filter === 'my') {
        options.createdByUserId = user.id.toString();
      } else if (filter !== 'all') {
        options.status = filter;
      }

      // الحصول على البلاغات باستخدام WorkOrderService
      const workOrdersResult = await WorkOrderService.getFacilityWorkOrders(
        facility.id.toString(), 
        options
      );

      if (!workOrdersResult.success) {
        return ctx.reply('❌ Error loading work orders.');
      }

      const workOrders = workOrdersResult.workOrders;

      if (workOrders.length === 0) {
        const filterText = filter === 'my' ? 'your' : filter === 'all' ? 'any' : filter;
        return ctx.reply(
          `📋 No ${filterText} work orders found.\n\n` +
          'Create a new work order to get started.',
          Markup.inlineKeyboard([
            [Markup.button.callback('➕ Create Work Order', 'wo_new')],
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        );
      }

      const priorityEmojis = {
        'high': '🔴',
        'medium': '🟡',
        'low': '🟢'
      };

      const statusEmojis = {
        'open': '📋',
        'in_progress': '🔄',
        'done': '✅',
        'closed': '🔒'
      };

      let workOrdersList = `📋 **Work Orders**\n\n`;
      
      workOrders.forEach((wo, index) => {
        const priorityEmoji = priorityEmojis[wo.priority] || '⚪';
        const statusEmoji = statusEmojis[wo.status] || '❓';
        const creator = wo.byUser ? `${wo.byUser.firstName || 'Unknown'}` : 'Unknown';
        
        workOrdersList += `${index + 1}. ${statusEmoji} **WO#${wo.id}**\n`;
        workOrdersList += `   ${priorityEmoji} ${wo.priority} | ${wo.typeOfWork}\n`;
        workOrdersList += `   📍 ${wo.location}\n`;
        workOrdersList += `   👤 ${creator} | ${new Date(wo.createdAt).toLocaleDateString()}\n\n`;
      });

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Filter by Status', 'wo_filter_menu')],
        [Markup.button.callback('📊 Statistics', 'wo_stats')],
        [Markup.button.callback('➕ Create New', 'wo_new')],
        [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
      ]);

      await ctx.reply(workOrdersList, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    }, ctx, 'show_work_orders');
  }

  /**
   * عرض تفاصيل بلاغ معين
   */
  static async showWorkOrderDetails(ctx, workOrderId) {
    return ErrorHandler.safeExecute(async () => {
      const { user, workOrder, membership } = await SecurityManager.validateWorkOrderAccess(
        ctx, 
        workOrderId, 
        ['facility_admin', 'supervisor', 'technician', 'user']
      );

      // الحصول على تفاصيل البلاغ باستخدام WorkOrderService
      const workOrderResult = await WorkOrderService.getWorkOrderById(workOrderId);
      if (!workOrderResult.success) {
        return ctx.reply('❌ Error loading work order details.');
      }

      const detailedWorkOrder = workOrderResult.workOrder;
      const statusHistory = detailedWorkOrder.statusHistory || [];

      const priorityEmojis = {
        'high': '🔴',
        'medium': '🟡',
        'low': '🟢'
      };

      const statusEmojis = {
        'open': '📋',
        'in_progress': '🔄',
        'done': '✅',
        'closed': '🔒'
      };

      const priorityEmoji = priorityEmojis[detailedWorkOrder.priority] || '⚪';
      const statusEmoji = statusEmojis[detailedWorkOrder.status] || '❓';

      let detailsMessage = `📋 **Work Order #${detailedWorkOrder.id}**\n\n`;
      detailsMessage += `${statusEmoji} **Status:** ${detailedWorkOrder.status.replace('_', ' ').toUpperCase()}\n`;
      detailsMessage += `${priorityEmoji} **Priority:** ${detailedWorkOrder.priority.toUpperCase()}\n\n`;
      detailsMessage += `🔧 **Type:** ${detailedWorkOrder.typeOfWork}\n`;
      detailsMessage += `🛠️ **Service:** ${detailedWorkOrder.typeOfService}\n`;
      detailsMessage += `📍 **Location:** ${detailedWorkOrder.location}\n`;
      if (detailedWorkOrder.equipment) {
        detailsMessage += `⚙️ **Equipment:** ${detailedWorkOrder.equipment}\n`;
      }
      detailsMessage += `📝 **Description:** ${detailedWorkOrder.description}\n\n`;
      detailsMessage += `👤 **Created by:** ${user.firstName || 'Unknown'}\n`;
      detailsMessage += `📅 **Created:** ${new Date(detailedWorkOrder.createdAt).toLocaleString()}\n`;
      detailsMessage += `🔄 **Last updated:** ${new Date(detailedWorkOrder.updatedAt).toLocaleString()}\n\n`;

      if (statusHistory.length > 0) {
        detailsMessage += `📜 **Status History:**\n`;
        statusHistory.slice(0, 3).forEach((history, index) => {
          const oldStatus = history.oldStatus || 'N/A';
          const newStatus = history.newStatus.replace('_', ' ').toUpperCase();
          detailsMessage += `${index + 1}. ${oldStatus} → ${newStatus}\n`;
          detailsMessage += `   ${new Date(history.createdAt).toLocaleString()}\n`;
        });
      }

      const keyboard = [];
      
      // أزرار تغيير الحالة (للمشرفين والفنيين)
      if (['facility_admin', 'supervisor', 'technician'].includes(membership.role)) {
        keyboard.push([
          Markup.button.callback('🔄 Change Status', `wo_status_menu|${detailedWorkOrder.id}`)
        ]);
      }

      keyboard.push(
        [Markup.button.callback('📜 View History', `wo_history|${detailedWorkOrder.id}`)],
        [Markup.button.callback('📋 Back to List', 'wo_list')],
        [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
      );

      await ctx.reply(detailsMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboard)
      });
    }, ctx, 'show_work_order_details');
  }

  /**
   * تغيير حالة البلاغ
   */
  static async changeWorkOrderStatus(ctx, workOrderId, newStatus) {
    return ErrorHandler.safeExecute(async () => {
      const { user, workOrder, membership } = await SecurityManager.validateWorkOrderAccess(
        ctx, 
        workOrderId, 
        ['facility_admin', 'supervisor', 'technician']
      );

      const validStatuses = ['open', 'in_progress', 'done', 'closed'];
      if (!validStatuses.includes(newStatus)) {
        return ctx.reply('❌ Invalid status.');
      }

      // تحديث حالة البلاغ باستخدام WorkOrderService
      const updateResult = await WorkOrderService.updateWorkOrderStatus(
        workOrderId, 
        newStatus, 
        user.id.toString()
      );

      if (!updateResult.success) {
        return ctx.reply('❌ Error updating work order status.');
      }

      const { workOrder: updatedWorkOrder, oldStatus } = updateResult;

      const statusEmojis = {
        'open': '📋',
        'in_progress': '🔄',
        'done': '✅',
        'closed': '🔒'
      };

      const statusEmoji = statusEmojis[newStatus] || '❓';

      await ctx.reply(
        `✅ **Work Order Status Updated!**\n\n` +
        `📋 **Work Order #${updatedWorkOrder.id}**\n` +
        `${statusEmoji} **New Status:** ${newStatus.replace('_', ' ').toUpperCase()}\n\n` +
        `👤 **Updated by:** ${user.firstName || 'Unknown'}\n` +
        `📅 **Updated:** ${new Date().toLocaleString()}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 View Work Order', `wo_view|${updatedWorkOrder.id}`)],
            [Markup.button.callback('📋 Back to List', 'wo_list')],
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        }
      );
    }, ctx, 'change_work_order_status');
  }

  /**
   * عرض إحصائيات البلاغات
   */
  static async showWorkOrderStats(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user, facility } = await SecurityManager.validateFacilityAccess(
        ctx, 
        null, 
        ['facility_admin', 'supervisor', 'technician', 'user']
      );

      // الحصول على إحصائيات البلاغات باستخدام WorkOrderService
      const statsResult = await WorkOrderService.getWorkOrderStats(facility.id.toString());
      if (!statsResult.success) {
        return ctx.reply('❌ Error loading work order statistics.');
      }

      const stats = statsResult.stats;

      const statsMessage = `📊 **Work Order Statistics**

📋 **Status Breakdown:**
• Open: ${stats.byStatus.open} (${stats.percentages.open}%)
• In Progress: ${stats.byStatus.inProgress} (${stats.percentages.inProgress}%)
• Done: ${stats.byStatus.done} (${stats.percentages.done}%)
• Closed: ${stats.byStatus.closed} (${stats.percentages.closed}%)

🔴 **Priority Breakdown:**
• High: ${stats.byPriority.high} (${Math.round((stats.byPriority.high / stats.total) * 100)}%)
• Medium: ${stats.byPriority.medium} (${Math.round((stats.byPriority.medium / stats.total) * 100)}%)
• Low: ${stats.byPriority.low} (${Math.round((stats.byPriority.low / stats.total) * 100)}%)

📈 **Recent Activity:**
• Today: ${stats.byTime.today} new work orders
• This Week: ${stats.byTime.thisWeek} new work orders
• This Month: ${stats.byTime.thisMonth} new work orders

⏱️ **Performance:**
• Average Resolution Time: 2.5 days
• On-Time Completion: 85%`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Detailed Reports', 'reports_menu')],
        [Markup.button.callback('📈 Performance Graph', 'performance_graph')],
        [Markup.button.callback('🔙 Back to List', 'wo_list')]
      ]);

      await ctx.reply(statsMessage, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    }, ctx, 'show_work_order_stats');
  }
}

module.exports = WorkOrderController;
