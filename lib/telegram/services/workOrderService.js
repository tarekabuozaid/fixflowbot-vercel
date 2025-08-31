/**
 * Work Order Service - خدمة إدارة البلاغات
 * 
 * هذا الملف يحتوي على منطق إدارة البلاغات
 */

const { prisma, handleDatabaseError } = require('./_db');
const { 
  createValidationError, 
  createNotFoundError, 
  createConflictError 
} = require('./errors');
const PlanService = require('./planService');

class WorkOrderService {
  
  /**
   * إنشاء بلاغ جديد
   */
  static async createWorkOrder(workOrderData) {
    try {
      // التحقق من البيانات المطلوبة
      if (!workOrderData.facilityId) {
        throw createValidationError('facilityId', 'Facility ID is required');
      }

      if (!workOrderData.createdByUserId) {
        throw createValidationError('createdByUserId', 'Creator user ID is required');
      }

      if (!workOrderData.description) {
        throw createValidationError('description', 'Description is required');
      }

      // التحقق من حدود الخطة
      const planCheck = await PlanService.checkPlanLimit(
        workOrderData.facilityId.toString(), 
        'workOrders', 
        1
      );

      if (!planCheck.success) {
        throw new Error(planCheck.message);
      }

      // إنشاء البلاغ
      const workOrder = await prisma.workOrder.create({
        data: {
          facilityId: BigInt(workOrderData.facilityId),
          createdByUserId: BigInt(workOrderData.createdByUserId),
          status: 'open',
          typeOfWork: workOrderData.typeOfWork,
          typeOfService: workOrderData.typeOfService,
          priority: workOrderData.priority || 'medium',
          location: workOrderData.location,
          equipment: workOrderData.equipment,
          description: workOrderData.description,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        include: {
          facility: true,
          byUser: true
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

      return {
        success: true,
        workOrder
      };
    } catch (error) {
      return handleDatabaseError(error, 'createWorkOrder');
    }
  }

  /**
   * الحصول على بلاغ بواسطة ID
   */
  static async getWorkOrderById(workOrderId) {
    try {
      const workOrder = await prisma.workOrder.findUnique({
        where: { id: BigInt(workOrderId) },
        include: {
          facility: true,
          byUser: true,
          statusHistory: {
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!workOrder) {
        throw createNotFoundError('Work order');
      }

      return {
        success: true,
        workOrder
      };
    } catch (error) {
      return handleDatabaseError(error, 'getWorkOrderById');
    }
  }

  /**
   * الحصول على بلاغات منشأة
   */
  static async getFacilityWorkOrders(facilityId, options = {}) {
    try {
      const { 
        status, 
        priority, 
        createdByUserId, 
        limit = 20, 
        offset = 0,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      const where = {
        facilityId: BigInt(facilityId)
      };

      if (status) {
        where.status = status;
      }

      if (priority) {
        where.priority = priority;
      }

      if (createdByUserId) {
        where.createdByUserId = BigInt(createdByUserId);
      }

      const workOrders = await prisma.workOrder.findMany({
        where,
        include: {
          byUser: true
        },
        orderBy: {
          [sortBy]: sortOrder
        },
        take: limit,
        skip: offset
      });

      const total = await prisma.workOrder.count({ where });

      return {
        success: true,
        workOrders,
        total,
        hasMore: offset + limit < total
      };
    } catch (error) {
      return handleDatabaseError(error, 'getFacilityWorkOrders');
    }
  }

  /**
   * تحديث حالة البلاغ
   */
  static async updateWorkOrderStatus(workOrderId, newStatus, updatedByUserId) {
    try {
      // التحقق من صحة الحالة
      const validStatuses = ['open', 'in_progress', 'done', 'closed'];
      if (!validStatuses.includes(newStatus)) {
        throw createValidationError('status', 'Invalid status');
      }

      // الحصول على البلاغ الحالي
      const workOrder = await prisma.workOrder.findUnique({
        where: { id: BigInt(workOrderId) }
      });

      if (!workOrder) {
        throw createNotFoundError('Work order');
      }

      const oldStatus = workOrder.status;

      // تحديث حالة البلاغ
      const updatedWorkOrder = await prisma.workOrder.update({
        where: { id: BigInt(workOrderId) },
        data: {
          status: newStatus,
          updatedAt: new Date()
        },
        include: {
          facility: true,
          byUser: true
        }
      });

      // إنشاء سجل التغيير
      await prisma.statusHistory.create({
        data: {
          workOrderId: BigInt(workOrderId),
          oldStatus: oldStatus,
          newStatus: newStatus,
          createdAt: new Date()
        }
      });

      return {
        success: true,
        workOrder: updatedWorkOrder,
        oldStatus,
        newStatus
      };
    } catch (error) {
      return handleDatabaseError(error, 'updateWorkOrderStatus');
    }
  }

  /**
   * تحديث بيانات البلاغ
   */
  static async updateWorkOrder(workOrderId, updateData) {
    try {
      // التحقق من وجود البلاغ
      const existingWorkOrder = await prisma.workOrder.findUnique({
        where: { id: BigInt(workOrderId) }
      });

      if (!existingWorkOrder) {
        throw createNotFoundError('Work order');
      }

      // التحقق من صحة البيانات
      if (updateData.priority && !['low', 'medium', 'high'].includes(updateData.priority)) {
        throw createValidationError('priority', 'Invalid priority');
      }

      // تحديث البلاغ
      const workOrder = await prisma.workOrder.update({
        where: { id: BigInt(workOrderId) },
        data: {
          ...updateData,
          updatedAt: new Date()
        },
        include: {
          facility: true,
          byUser: true
        }
      });

      return {
        success: true,
        workOrder
      };
    } catch (error) {
      return handleDatabaseError(error, 'updateWorkOrder');
    }
  }

  /**
   * حذف بلاغ
   */
  static async deleteWorkOrder(workOrderId) {
    try {
      // التحقق من وجود البلاغ
      const workOrder = await prisma.workOrder.findUnique({
        where: { id: BigInt(workOrderId) }
      });

      if (!workOrder) {
        throw createNotFoundError('Work order');
      }

      // حذف سجلات الحالة أولاً
      await prisma.statusHistory.deleteMany({
        where: { workOrderId: BigInt(workOrderId) }
      });

      // حذف البلاغ
      await prisma.workOrder.delete({
        where: { id: BigInt(workOrderId) }
      });

      return {
        success: true,
        message: 'Work order deleted successfully'
      };
    } catch (error) {
      return handleDatabaseError(error, 'deleteWorkOrder');
    }
  }

  /**
   * الحصول على إحصائيات البلاغات
   */
  static async getWorkOrderStats(facilityId) {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

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
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId) } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), status: 'open' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), status: 'in_progress' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), status: 'done' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), status: 'closed' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), priority: 'high' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), priority: 'medium' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), priority: 'low' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), createdAt: { gte: today } } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), createdAt: { gte: weekAgo } } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), createdAt: { gte: monthAgo } } })
      ]);

      return {
        success: true,
        stats: {
          total,
          byStatus: {
            open,
            inProgress,
            done,
            closed
          },
          byPriority: {
            high: highPriority,
            medium: mediumPriority,
            low: lowPriority
          },
          byTime: {
            today,
            thisWeek,
            thisMonth
          },
          percentages: {
            open: total > 0 ? Math.round((open / total) * 100) : 0,
            inProgress: total > 0 ? Math.round((inProgress / total) * 100) : 0,
            done: total > 0 ? Math.round((done / total) * 100) : 0,
            closed: total > 0 ? Math.round((closed / total) * 100) : 0
          }
        }
      };
    } catch (error) {
      return handleDatabaseError(error, 'getWorkOrderStats');
    }
  }

  /**
   * البحث في البلاغات
   */
  static async searchWorkOrders(facilityId, query, options = {}) {
    try {
      const { limit = 20, offset = 0 } = options;

      const workOrders = await prisma.workOrder.findMany({
        where: {
          facilityId: BigInt(facilityId),
          OR: [
            { description: { contains: query, mode: 'insensitive' } },
            { location: { contains: query, mode: 'insensitive' } },
            { equipment: { contains: query, mode: 'insensitive' } }
          ]
        },
        include: {
          byUser: true
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      });

      const total = await prisma.workOrder.count({
        where: {
          facilityId: BigInt(facilityId),
          OR: [
            { description: { contains: query, mode: 'insensitive' } },
            { location: { contains: query, mode: 'insensitive' } },
            { equipment: { contains: query, mode: 'insensitive' } }
          ]
        }
      });

      return {
        success: true,
        workOrders,
        total,
        hasMore: offset + limit < total
      };
    } catch (error) {
      return handleDatabaseError(error, 'searchWorkOrders');
    }
  }

  /**
   * الحصول على سجل الحالة
   */
  static async getStatusHistory(workOrderId) {
    try {
      const history = await prisma.statusHistory.findMany({
        where: { workOrderId: BigInt(workOrderId) },
        orderBy: { createdAt: 'desc' }
      });

      return {
        success: true,
        history
      };
    } catch (error) {
      return handleDatabaseError(error, 'getStatusHistory');
    }
  }
}

module.exports = WorkOrderService;
