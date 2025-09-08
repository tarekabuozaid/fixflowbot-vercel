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
const { PrismaClient } = require('@prisma/client');

// Import utilities
const SecurityManager = require('../utils/security');
const FlowManager = require('../utils/flowManager');
const PlanManager = require('../utils/planManager');
const ErrorHandler = require('../utils/errorHandler');

const prisma = new PrismaClient();

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

      // التحقق من حدود الخطة
      await PlanManager.checkPlanLimit(user.activeFacilityId.toString(), 'workOrders', 1);

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
          
          // إنشاء البلاغ
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
      // التحقق من حدود الخطة مرة أخرى
      await PlanManager.checkPlanLimit(user.activeFacilityId.toString(), 'workOrders', 1);

      // إنشاء البلاغ
      const workOrder = await prisma.workOrder.create({
        data: {
          facilityId: user.activeFacilityId,
          createdByUserId: user.id,
          status: 'open',
          typeOfWork: workOrderData.typeOfWork,
          typeOfService: workOrderData.typeOfService,
          priority: workOrderData.priority,
          location: workOrderData.location,
          equipment: workOrderData.equipment,
          description: workOrderData.description
        }
      });

      // إنشاء سجل الحالة
      await prisma.statusHistory.create({
        data: {
          workOrderId: workOrder.id,
          oldStatus: '',
          newStatus: 'open',
          createdAt: new Date()
        }
      });

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

      // بناء شروط البحث
      const where = { facilityId: facility.id };
      
      if (filter === 'my') {
        where.createdByUserId = user.id;
      } else if (filter !== 'all') {
        where.status = filter;
      }

      const workOrders = await prisma.workOrder.findMany({
        where,
        include: {
          byUser: true
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' }
        ],
        take: 10
      });

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

      const statusHistory = await prisma.statusHistory.findMany({
        where: { workOrderId: workOrder.id },
        orderBy: { createdAt: 'desc' }
      });

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

      const priorityEmoji = priorityEmojis[workOrder.priority] || '⚪';
      const statusEmoji = statusEmojis[workOrder.status] || '❓';

      let detailsMessage = `📋 **Work Order #${workOrder.id}**\n\n`;
      detailsMessage += `${statusEmoji} **Status:** ${workOrder.status.replace('_', ' ').toUpperCase()}\n`;
      detailsMessage += `${priorityEmoji} **Priority:** ${workOrder.priority.toUpperCase()}\n\n`;
      detailsMessage += `🔧 **Type:** ${workOrder.typeOfWork}\n`;
      detailsMessage += `🛠️ **Service:** ${workOrder.typeOfService}\n`;
      detailsMessage += `📍 **Location:** ${workOrder.location}\n`;
      if (workOrder.equipment) {
        detailsMessage += `⚙️ **Equipment:** ${workOrder.equipment}\n`;
      }
      detailsMessage += `📝 **Description:** ${workOrder.description}\n\n`;
      detailsMessage += `👤 **Created by:** ${user.firstName || 'Unknown'}\n`;
      detailsMessage += `📅 **Created:** ${new Date(workOrder.createdAt).toLocaleString()}\n`;
      detailsMessage += `🔄 **Last updated:** ${new Date(workOrder.updatedAt).toLocaleString()}\n\n`;

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
          Markup.button.callback('🔄 Change Status', `wo_status_menu|${workOrder.id}`)
        ]);
      }

      keyboard.push(
        [Markup.button.callback('📜 View History', `wo_history|${workOrder.id}`)],
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

      const oldStatus = workOrder.status;
      
      // تحديث حالة البلاغ
      await prisma.workOrder.update({
        where: { id: workOrder.id },
        data: { status: newStatus }
      });

      // إنشاء سجل التغيير
      await prisma.statusHistory.create({
        data: {
          workOrderId: workOrder.id,
          oldStatus: oldStatus,
          newStatus: newStatus,
          createdAt: new Date()
        }
      });

      const statusEmojis = {
        'open': '📋',
        'in_progress': '🔄',
        'done': '✅',
        'closed': '🔒'
      };

      const statusEmoji = statusEmojis[newStatus] || '❓';

      await ctx.reply(
        `✅ **Work Order Status Updated!**\n\n` +
        `📋 **Work Order #${workOrder.id}**\n` +
        `${statusEmoji} **New Status:** ${newStatus.replace('_', ' ').toUpperCase()}\n\n` +
        `👤 **Updated by:** ${user.firstName || 'Unknown'}\n` +
        `📅 **Updated:** ${new Date().toLocaleString()}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 View Work Order', `wo_view|${workOrder.id}`)],
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

      const stats = await this.getWorkOrderStats(facility.id);

      const statsMessage = `📊 **Work Order Statistics**

📋 **Status Breakdown:**
• Open: ${stats.open} (${stats.openPercentage}%)
• In Progress: ${stats.inProgress} (${stats.inProgressPercentage}%)
• Done: ${stats.done} (${stats.donePercentage}%)
• Closed: ${stats.closed} (${stats.closedPercentage}%)

🔴 **Priority Breakdown:**
• High: ${stats.highPriority} (${stats.highPriorityPercentage}%)
• Medium: ${stats.mediumPriority} (${stats.mediumPriorityPercentage}%)
• Low: ${stats.lowPriority} (${stats.lowPriorityPercentage}%)

📈 **Recent Activity:**
• Today: ${stats.today} new work orders
• This Week: ${stats.thisWeek} new work orders
• This Month: ${stats.thisMonth} new work orders

⏱️ **Performance:**
• Average Resolution Time: ${stats.avgResolutionTime} days
• On-Time Completion: ${stats.onTimeCompletion}%`;

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

  /**
   * الحصول على إحصائيات البلاغات
   */
  static async getWorkOrderStats(facilityId) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      total,
      open,
      inProgress,
      done,
      closed,
      highPriority,
      mediumPriority,
      lowPriority,
      today,
      thisWeek,
      thisMonth
    ] = await Promise.all([
      prisma.workOrder.count({ where: { facilityId } }),
      prisma.workOrder.count({ where: { facilityId, status: 'open' } }),
      prisma.workOrder.count({ where: { facilityId, status: 'in_progress' } }),
      prisma.workOrder.count({ where: { facilityId, status: 'done' } }),
      prisma.workOrder.count({ where: { facilityId, status: 'closed' } }),
      prisma.workOrder.count({ where: { facilityId, priority: 'high' } }),
      prisma.workOrder.count({ where: { facilityId, priority: 'medium' } }),
      prisma.workOrder.count({ where: { facilityId, priority: 'low' } }),
      prisma.workOrder.count({ where: { facilityId, createdAt: { gte: todayStart } } }),
      prisma.workOrder.count({ where: { facilityId, createdAt: { gte: weekAgo } } }),
      prisma.workOrder.count({ where: { facilityId, createdAt: { gte: monthAgo } } })
    ]);

    return {
      total,
      open,
      inProgress,
      done,
      closed,
      highPriority,
      mediumPriority,
      lowPriority,
      today,
      thisWeek,
      thisMonth,
      openPercentage: total > 0 ? Math.round((open / total) * 100) : 0,
      inProgressPercentage: total > 0 ? Math.round((inProgress / total) * 100) : 0,
      donePercentage: total > 0 ? Math.round((done / total) * 100) : 0,
      closedPercentage: total > 0 ? Math.round((closed / total) * 100) : 0,
      highPriorityPercentage: total > 0 ? Math.round((highPriority / total) * 100) : 0,
      mediumPriorityPercentage: total > 0 ? Math.round((mediumPriority / total) * 100) : 0,
      lowPriorityPercentage: total > 0 ? Math.round((lowPriority / total) * 100) : 0,
      avgResolutionTime: '2.5', // Placeholder
      onTimeCompletion: 85 // Placeholder
    };
  }
}

module.exports = WorkOrderController;
