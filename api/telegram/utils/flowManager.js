/**
 * ============================================================================
 * FLOW MANAGER - إدارة الفلوهات التفاعلية
 * ============================================================================
 * 
 * هذا الملف يدير الفلوهات التفاعلية للمستخدمين في البوت
 * 
 * الميزات الرئيسية:
 * - إدارة حالة الفلو لكل مستخدم
 * - تتبع الخطوات الحالية
 * - حفظ البيانات المؤقتة
 * - تنظيف الفلوهات المنتهية الصلاحية
 * - التحقق من ملكية الفلو
 * 
 * أنواع الفلوهات المدعومة:
 * - reg_fac: تسجيل منشأة جديدة
 * - register_user: تسجيل مستخدم عادي
 * - register_technician: تسجيل فني
 * - register_supervisor: تسجيل مشرف
 * - wo_new: إنشاء طلب صيانة جديد
 * - reminder_new: إنشاء تذكير جديد
 * 
 * تاريخ آخر تحديث: 31 أغسطس 2025
 * المطور: Tarek Abu Ozaid
 * ============================================================================
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class FlowManager {
  /**
   * Set user flow state in the database
   * @param {string} userId - User ID
   * @param {string} flow - Flow type
   * @param {number|string} step - Current step
   * @param {Object} data - Flow data
   */
  static async setFlow(userId, flow, step, data = {}) {
    const userIdStr = userId.toString();
    const flowData = {
      flow,
      step: parseInt(step, 10),
      data,
    };
    await prisma.flowState.upsert({
      where: { id: userIdStr },
      update: { ...flowData, updatedAt: new Date() },
      create: { id: userIdStr, ...flowData },
    });
    console.log(`FlowManager: Set flow for user ${userId} in DB`, flowData);
  }

  /**
   * Get user flow state from the database
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Flow state or null if not found
   */
  static async getFlow(userId) {
    const userIdStr = userId.toString();
    const flow = await prisma.flowState.findUnique({
      where: { id: userIdStr },
    });

    if (flow) {
      // Cleanup expired flows (older than 1 hour)
      const oneHour = 60 * 60 * 1000;
      if (new Date() - flow.updatedAt > oneHour) {
        await this.clearFlow(userIdStr);
        return null;
      }
    }
    
    console.log(`FlowManager: Get flow for user ${userId} from DB`, flow);
    return flow;
  }

  /**
   * Update flow step in the database
   * @param {string} userId - User ID
   * @param {number|string} step - New step
   */
  static async updateStep(userId, step) {
    const userIdStr = userId.toString();
    const flow = await this.getFlow(userIdStr);
    if (flow) {
      await prisma.flowState.update({
        where: { id: userIdStr },
        data: { step: parseInt(step, 10), updatedAt: new Date() },
      });
      console.log(`FlowManager: Updated step for user ${userId} to ${step} in DB`);
    } else {
      console.error(`FlowManager: Cannot update step for user ${userId} - flow not found`);
    }
  }

  /**
   * Update flow data in the database
   * @param {string} userId - User ID
   * @param {Object} data - New data to merge
   */
  static async updateData(userId, data) {
    const userIdStr = userId.toString();
    const flow = await this.getFlow(userIdStr);
    if (flow) {
      const newData = { ...flow.data, ...data };
      await prisma.flowState.update({
        where: { id: userIdStr },
        data: { data: newData, updatedAt: new Date() },
      });
      console.log(`FlowManager: Updated data for user ${userId} in DB`, data);
    } else {
      console.error(`FlowManager: Cannot update data for user ${userId} - flow not found`);
    }
  }

  /**
   * Clear user flow from the database
   * @param {string} userId - User ID
   */
  static async clearFlow(userId) {
    const userIdStr = userId.toString();
    await prisma.flowState.delete({
      where: { id: userIdStr },
    }).catch(() => {
      // Ignore if flow doesn't exist
    });
    console.log(`FlowManager: Cleared flow for user ${userId} from DB`);
  }

  /**
   * Check if user has an active flow
   * @param {string} userId - User ID
   * @param {string} flowType - Expected flow type (optional)
   * @returns {Promise<boolean>} True if user has an active flow
   */
  static async hasActiveFlow(userId, flowType = null) {
    const flow = await this.getFlow(userId.toString());
    if (!flow) return false;
    if (flowType && flow.flow !== flowType) return false;
    return true;
  }

  /**
   * Validate flow ownership (remains synchronous as it's a simple check)
   * @param {string} userId - User ID
   * @param {Object} flowState - Flow state to validate
   * @returns {boolean} True if flow belongs to user
   */
  static validateFlowOwnership(userId, flowState) {
    // The ID of flowState is the userId, so this check is straightforward
    return flowState && flowState.id === userId.toString();
  }

  /**
   * Clean up all expired flows from the database.
   * This can be run as a cron job.
   */
  static async cleanupExpiredFlows() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const result = await prisma.flowState.deleteMany({
      where: {
        updatedAt: {
          lt: oneHourAgo,
        },
      },
    });
    console.log(`FlowManager: Cleaned up ${result.count} expired flows.`);
  }
}

// No longer need setInterval for cleanup as it's handled within getFlow
// or can be a separate cron job.

module.exports = FlowManager;
