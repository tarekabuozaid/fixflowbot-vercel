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
 * - work_order_new: إنشاء طلب صيانة جديد
 * - reminder_new: إنشاء تذكير جديد
 * 
 * تاريخ آخر تحديث: 31 أغسطس 2025
 * المطور: Tarek Abu Ozaid
 * ============================================================================
 */

// ===== Flow State Storage =====
// تخزين حالة الفلو في الذاكرة مع الأمان
// كل مدخل يحتوي على: { flow: string, step: number|string, data: object, userId: string, timestamp: number }
const flows = new Map();

class FlowManager {
  /**
   * Set user flow state
   * @param {string} userId - User ID
   * @param {string} flow - Flow type
   * @param {number|string} step - Current step
   * @param {Object} data - Flow data
   */
  static setFlow(userId, flow, step, data = {}) {
    flows.set(userId.toString(), { 
      flow, 
      step, 
      data, 
      userId: userId.toString(),
      timestamp: Date.now() 
    });
  }

  /**
   * Get user flow state
   * @param {string} userId - User ID
   * @returns {Object|null} Flow state or null if not found
   */
  static getFlow(userId) {
    return flows.get(userId.toString());
  }

  /**
   * Update flow step
   * @param {string} userId - User ID
   * @param {number|string} step - New step
   */
  static updateStep(userId, step) {
    const flow = flows.get(userId.toString());
    if (flow) {
      flow.step = step;
      flow.timestamp = Date.now();
      flows.set(userId.toString(), flow);
    }
  }

  /**
   * Update flow data
   * @param {string} userId - User ID
   * @param {Object} data - New data to merge
   */
  static updateData(userId, data) {
    const flow = flows.get(userId.toString());
    if (flow) {
      flow.data = { ...flow.data, ...data };
      flow.timestamp = Date.now();
      flows.set(userId.toString(), flow);
    }
  }

  /**
   * Clear user flow
   * @param {string} userId - User ID
   */
  static clearFlow(userId) {
    flows.delete(userId.toString());
  }

  /**
   * Check if user has active flow
   * @param {string} userId - User ID
   * @param {string} flowType - Expected flow type (optional)
   * @returns {boolean} True if user has active flow
   */
  static hasActiveFlow(userId, flowType = null) {
    const flow = flows.get(userId.toString());
    if (!flow) return false;
    
    if (flowType && flow.flow !== flowType) return false;
    
    // Check if flow is not expired (1 hour)
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    return (now - flow.timestamp) < oneHour;
  }

  /**
   * Validate flow ownership
   * @param {string} userId - User ID
   * @param {Object} flowState - Flow state to validate
   * @returns {boolean} True if flow belongs to user
   */
  static validateFlowOwnership(userId, flowState) {
    return flowState && flowState.userId === userId.toString();
  }

  /**
   * Get flow statistics
   * @returns {Object} Flow statistics
   */
  static getFlowStats() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    let activeFlows = 0;
    let expiredFlows = 0;
    const flowTypes = new Map();
    
    for (const [userId, flow] of flows.entries()) {
      if ((now - flow.timestamp) < oneHour) {
        activeFlows++;
        flowTypes.set(flow.flow, (flowTypes.get(flow.flow) || 0) + 1);
      } else {
        expiredFlows++;
      }
    }
    
    return {
      total: flows.size,
      active: activeFlows,
      expired: expiredFlows,
      flowTypes: Object.fromEntries(flowTypes)
    };
  }

  /**
   * Clean up expired flows
   */
  static cleanupExpiredFlows() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [userId, flow] of flows.entries()) {
      if ((now - flow.timestamp) > oneHour) {
        flows.delete(userId);
      }
    }
  }

  /**
   * Get all active flows of a specific type
   * @param {string} flowType - Flow type to filter
   * @returns {Array} Array of active flows
   */
  static getActiveFlowsByType(flowType) {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const activeFlows = [];
    
    for (const [userId, flow] of flows.entries()) {
      if (flow.flow === flowType && (now - flow.timestamp) < oneHour) {
        activeFlows.push({ userId, ...flow });
      }
    }
    
    return activeFlows;
  }
}

// Clean up old flows every 30 minutes
setInterval(() => {
  FlowManager.cleanupExpiredFlows();
}, 30 * 60 * 1000);

module.exports = FlowManager;
