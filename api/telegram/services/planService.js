/**
 * Plan Service - خدمة إدارة الخطط
 * 
 * هذا الملف يحتوي على منطق إدارة الخطط والحدود
 */

const { prisma, handleDatabaseError } = require('./_db');
const { createPlanLimitError } = require('./errors');

// تعريف حدود الخطط
const PLAN_LIMITS = {
  Free: {
    members: 5,
    workOrders: 50,
    reports: 3,
    reminders: 10
  },
  Pro: {
    members: 20,
    workOrders: 200,
    reports: 15,
    reminders: 50
  },
  Business: {
    members: 100,
    workOrders: 1000,
    reports: 100,
    reminders: 200
  }
};

class PlanService {
  
  /**
   * التحقق من حدود الخطة
   */
  static async checkPlanLimit(facilityId, limitType, increment = 0) {
    try {
      const facility = await prisma.facility.findUnique({
        where: { id: BigInt(facilityId) }
      });

      if (!facility) {
        throw new Error('Facility not found');
      }

      const planLimits = PLAN_LIMITS[facility.planTier];
      if (!planLimits) {
        throw new Error('Invalid plan tier');
      }

      const maxLimit = planLimits[limitType];
      if (maxLimit === undefined) {
        throw new Error('Invalid limit type');
      }

      // الحصول على العدد الحالي
      let currentCount = 0;
      
      switch (limitType) {
        case 'members':
          currentCount = await prisma.facilityMember.count({
            where: { facilityId: BigInt(facilityId) }
          });
          break;
          
        case 'workOrders':
          currentCount = await prisma.workOrder.count({
            where: { facilityId: BigInt(facilityId) }
          });
          break;
          
        case 'reports':
          // Placeholder - سيتم تنفيذها لاحقاً
          currentCount = 0;
          break;
          
        case 'reminders':
          currentCount = await prisma.reminder.count({
            where: { facilityId: BigInt(facilityId) }
          });
          break;
          
        default:
          throw new Error('Unknown limit type');
      }

      // التحقق من الحد
      if (currentCount + increment > maxLimit) {
        throw createPlanLimitError(limitType, currentCount, maxLimit);
      }

      return {
        success: true,
        current: currentCount,
        max: maxLimit,
        remaining: maxLimit - currentCount
      };
    } catch (error) {
      return handleDatabaseError(error, 'checkPlanLimit');
    }
  }

  /**
   * الحصول على معلومات الخطة
   */
  static async getPlanInfo(facilityId) {
    try {
      const facility = await prisma.facility.findUnique({
        where: { id: BigInt(facilityId) }
      });

      if (!facility) {
        throw new Error('Facility not found');
      }

      const planLimits = PLAN_LIMITS[facility.planTier];
      if (!planLimits) {
        throw new Error('Invalid plan tier');
      }

      // الحصول على الإحصائيات الحالية
      const [members, workOrders, reminders] = await Promise.all([
        prisma.facilityMember.count({
          where: { facilityId: BigInt(facilityId) }
        }),
        prisma.workOrder.count({
          where: { facilityId: BigInt(facilityId) }
        }),
        prisma.reminder.count({
          where: { facilityId: BigInt(facilityId) }
        })
      ]);

      return {
        success: true,
        plan: facility.planTier,
        limits: planLimits,
        usage: {
          members: { current: members, max: planLimits.members },
          workOrders: { current: workOrders, max: planLimits.workOrders },
          reminders: { current: reminders, max: planLimits.reminders }
        }
      };
    } catch (error) {
      return handleDatabaseError(error, 'getPlanInfo');
    }
  }

  /**
   * ترقية الخطة
   */
  static async upgradePlan(facilityId, newPlan) {
    try {
      if (!PLAN_LIMITS[newPlan]) {
        throw new Error('Invalid plan tier');
      }

      const facility = await prisma.facility.update({
        where: { id: BigInt(facilityId) },
        data: { planTier: newPlan }
      });

      return {
        success: true,
        facility,
        newPlan,
        limits: PLAN_LIMITS[newPlan]
      };
    } catch (error) {
      return handleDatabaseError(error, 'upgradePlan');
    }
  }

  /**
   * الحصول على مقارنة الخطط
   */
  static getPlanComparison() {
    return {
      success: true,
      plans: PLAN_LIMITS
    };
  }

  /**
   * الحصول على الخطط المتاحة
   */
  static getAvailablePlans() {
    return {
      success: true,
      plans: Object.keys(PLAN_LIMITS).map(plan => ({
        name: plan,
        limits: PLAN_LIMITS[plan]
      }))
    };
  }

  /**
   * التحقق من تحذيرات الخطة
   */
  static async checkPlanWarnings(facilityId) {
    try {
      const planInfo = await this.getPlanInfo(facilityId);
      if (!planInfo.success) {
        return planInfo;
      }

      const warnings = [];
      const { usage } = planInfo;

      // التحقق من استخدام الأعضاء
      const memberUsage = (usage.members.current / usage.members.max) * 100;
      if (memberUsage >= 80) {
        warnings.push({
          type: 'members',
          message: `Member limit is ${memberUsage.toFixed(1)}% full`,
          severity: memberUsage >= 90 ? 'high' : 'medium'
        });
      }

      // التحقق من استخدام البلاغات
      const workOrderUsage = (usage.workOrders.current / usage.workOrders.max) * 100;
      if (workOrderUsage >= 80) {
        warnings.push({
          type: 'workOrders',
          message: `Work order limit is ${workOrderUsage.toFixed(1)}% full`,
          severity: workOrderUsage >= 90 ? 'high' : 'medium'
        });
      }

      return {
        success: true,
        warnings,
        hasWarnings: warnings.length > 0
      };
    } catch (error) {
      return handleDatabaseError(error, 'checkPlanWarnings');
    }
  }

  /**
   * الحصول على إحصائيات الخطة العامة
   */
  static async getGlobalPlanStats() {
    try {
      const facilities = await prisma.facility.findMany({
        select: { planTier: true }
      });

      const stats = {
        total: facilities.length,
        byPlan: {}
      };

      facilities.forEach(facility => {
        stats.byPlan[facility.planTier] = (stats.byPlan[facility.planTier] || 0) + 1;
      });

      return {
        success: true,
        stats
      };
    } catch (error) {
      return handleDatabaseError(error, 'getGlobalPlanStats');
    }
  }
}

module.exports = PlanService;
