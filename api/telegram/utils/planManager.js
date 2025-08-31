/**
 * ============================================================================
 * PLAN MANAGER - إدارة خطط الاشتراك
 * ============================================================================
 * 
 * هذا الملف يدير خطط الاشتراك والحدود في البوت
 * 
 * الميزات الرئيسية:
 * - التحقق من حدود الخطط
 * - إدارة خطط الاشتراك المختلفة
 * - حساب الإحصائيات والاستخدام
 * - التحقق من إمكانية تنفيذ العمليات
 * - إدارة ترقيات وتخفيضات الخطط
 * 
 * خطط الاشتراك المدعومة:
 * - Free: الخطة المجانية (5 أعضاء، 50 طلب صيانة)
 * - Pro: الخطة الاحترافية (20 عضو، 200 طلب صيانة)
 * - Business: الخطة التجارية (100 عضو، 1000 طلب صيانة)
 * 
 * تاريخ آخر تحديث: 31 أغسطس 2025
 * المطور: Tarek Abu Ozaid
 * ============================================================================
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ===== خطط الاشتراك والحدود =====
/**
 * حدود خطط الاشتراك المختلفة
 * 
 * Free: الخطة المجانية - مناسبة للمنشآت الصغيرة
 * Pro: الخطة الاحترافية - مناسبة للمنشآت المتوسطة
 * Business: الخطة التجارية - مناسبة للمنشآت الكبيرة
 */
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

class PlanManager {
  /**
   * Check if facility can perform action within plan limits
   * @param {string} facilityId - Facility ID
   * @param {string} action - Action type (members, workOrders, reports, reminders)
   * @param {number} count - Number of items to add
   * @returns {Object} Plan check result
   */
  static async checkPlanLimit(facilityId, action, count = 1) {
    try {
      const facility = await prisma.facility.findUnique({
        where: { id: BigInt(facilityId) }
      });
      
      if (!facility) {
        throw new Error('Facility not found');
      }
      
      const plan = facility.planTier || 'Free';
      const limits = PLAN_LIMITS[plan];
      
      if (!limits) {
        throw new Error('Invalid plan');
      }
      
      let currentCount = 0;
      
      switch (action) {
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
          currentCount = await prisma.report.count({
            where: { facilityId: BigInt(facilityId) }
          });
          break;
        case 'reminders':
          currentCount = await prisma.reminder.count({
            where: { facilityId: BigInt(facilityId) }
          });
          break;
        default:
          throw new Error('Invalid action');
      }
      
      const newTotal = currentCount + count;
      const limit = limits[action];
      
      if (newTotal > limit) {
        throw new Error(`${action} limit exceeded for ${plan} plan. Limit: ${limit}, Current: ${currentCount}, Requested: ${count}`);
      }
      
      return { 
        allowed: true, 
        current: currentCount, 
        limit, 
        plan,
        remaining: limit - currentCount
      };
    } catch (error) {
      console.error('Plan limit check error:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive plan information for facility
   * @param {string} facilityId - Facility ID
   * @returns {Object} Plan information and usage statistics
   */
  static async getPlanInfo(facilityId) {
    try {
      const facility = await prisma.facility.findUnique({
        where: { id: BigInt(facilityId) }
      });
      
      if (!facility) {
        throw new Error('Facility not found');
      }
      
      const plan = facility.planTier || 'Free';
      const limits = PLAN_LIMITS[plan];
      
      const [members, workOrders, reports, reminders] = await Promise.all([
        prisma.facilityMember.count({ where: { facilityId: BigInt(facilityId) } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId) } }),
        prisma.report.count({ where: { facilityId: BigInt(facilityId) } }),
        prisma.reminder.count({ where: { facilityId: BigInt(facilityId) } })
      ]);
      
      return {
        plan,
        limits,
        usage: {
          members,
          workOrders,
          reports,
          reminders
        },
        percentages: {
          members: Math.round((members / limits.members) * 100),
          workOrders: Math.round((workOrders / limits.workOrders) * 100),
          reports: Math.round((reports / limits.reports) * 100),
          reminders: Math.round((reminders / limits.reminders) * 100)
        },
        remaining: {
          members: limits.members - members,
          workOrders: limits.workOrders - workOrders,
          reports: limits.reports - reports,
          reminders: limits.reminders - reminders
        }
      };
    } catch (error) {
      console.error('Get plan info error:', error);
      throw error;
    }
  }

  /**
   * Upgrade facility plan
   * @param {string} facilityId - Facility ID
   * @param {string} newPlan - New plan tier
   * @returns {Object} Upgrade result
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
      console.error('Plan upgrade error:', error);
      throw error;
    }
  }

  /**
   * Get plan comparison
   * @param {string} currentPlan - Current plan
   * @param {string} targetPlan - Target plan
   * @returns {Object} Plan comparison
   */
  static getPlanComparison(currentPlan = 'Free', targetPlan = 'Pro') {
    const current = PLAN_LIMITS[currentPlan];
    const target = PLAN_LIMITS[targetPlan];
    
    if (!current || !target) {
      throw new Error('Invalid plan tier');
    }
    
    return {
      current: currentPlan,
      target: targetPlan,
      improvements: {
        members: target.members - current.members,
        workOrders: target.workOrders - current.workOrders,
        reports: target.reports - current.reports,
        reminders: target.reminders - current.reminders
      },
      percentages: {
        members: Math.round((target.members / current.members) * 100),
        workOrders: Math.round((target.workOrders / current.workOrders) * 100),
        reports: Math.round((target.reports / current.reports) * 100),
        reminders: Math.round((target.reminders / current.reminders) * 100)
      }
    };
  }

  /**
   * Get all available plans
   * @returns {Object} All available plans
   */
  static getAvailablePlans() {
    return PLAN_LIMITS;
  }

  /**
   * Check if facility is approaching limits
   * @param {string} facilityId - Facility ID
   * @param {number} threshold - Warning threshold percentage (default: 80)
   * @returns {Object} Warning status for each resource
   */
  static async checkPlanWarnings(facilityId, threshold = 80) {
    try {
      const planInfo = await this.getPlanInfo(facilityId);
      const warnings = {};
      
      Object.keys(planInfo.percentages).forEach(resource => {
        const percentage = planInfo.percentages[resource];
        warnings[resource] = {
          percentage,
          isWarning: percentage >= threshold,
          isCritical: percentage >= 95,
          remaining: planInfo.remaining[resource]
        };
      });
      
      return {
        facilityId,
        plan: planInfo.plan,
        warnings,
        hasWarnings: Object.values(warnings).some(w => w.isWarning),
        hasCritical: Object.values(warnings).some(w => w.isCritical)
      };
    } catch (error) {
      console.error('Plan warnings check error:', error);
      throw error;
    }
  }

  /**
   * Get plan usage statistics across all facilities
   * @returns {Object} Global plan statistics
   */
  static async getGlobalPlanStats() {
    try {
      const facilities = await prisma.facility.findMany({
        where: { status: 'active' }
      });
      
      const planStats = {};
      let totalFacilities = 0;
      
      for (const facility of facilities) {
        const plan = facility.planTier || 'Free';
        if (!planStats[plan]) {
          planStats[plan] = { count: 0, usage: { members: 0, workOrders: 0, reports: 0, reminders: 0 } };
        }
        
        planStats[plan].count++;
        totalFacilities++;
        
        // Get facility usage
        const [members, workOrders, reports, reminders] = await Promise.all([
          prisma.facilityMember.count({ where: { facilityId: facility.id } }),
          prisma.workOrder.count({ where: { facilityId: facility.id } }),
          prisma.report.count({ where: { facilityId: facility.id } }),
          prisma.reminder.count({ where: { facilityId: facility.id } })
        ]);
        
        planStats[plan].usage.members += members;
        planStats[plan].usage.workOrders += workOrders;
        planStats[plan].usage.reports += reports;
        planStats[plan].usage.reminders += reminders;
      }
      
      return {
        totalFacilities,
        planStats,
        averageUsage: Object.keys(planStats).reduce((acc, plan) => {
          const limits = PLAN_LIMITS[plan];
          const usage = planStats[plan].usage;
          
          acc[plan] = {
            members: Math.round((usage.members / (limits.members * planStats[plan].count)) * 100),
            workOrders: Math.round((usage.workOrders / (limits.workOrders * planStats[plan].count)) * 100),
            reports: Math.round((usage.reports / (limits.reports * planStats[plan].count)) * 100),
            reminders: Math.round((usage.reminders / (limits.reminders * planStats[plan].count)) * 100)
          };
          
          return acc;
        }, {})
      };
    } catch (error) {
      console.error('Global plan stats error:', error);
      throw error;
    }
  }
}

module.exports = PlanManager;
