/**
 * Smart Flow Manager - مدير التدفق الذكي المحسن
 * 
 * هذا الملف يحتوي على مدير تدفق ذكي محسن يدعم:
 * - التقدم التدريجي مع شريط التقدم
 * - حفظ البيانات المؤقتة
 * - العودة للخطوات السابقة
 * - التحقق من صحة البيانات
 * - الإشعارات للمستخدم
 * - إلغاء العملية في أي وقت
 * - تتبع الحالة
 * - تعديل البيانات
 */

const { PrismaClient } = require('@prisma/client');
const { Markup } = require('telegraf');

const prisma = new PrismaClient();

class SmartFlowManager {
  
  /**
   * بدء تدفق ذكي جديد
   * @param {string} userId - معرف المستخدم
   * @param {string} flowType - نوع التدفق
   * @param {Object} initialData - البيانات الأولية
   * @param {Object} flowConfig - إعدادات التدفق
   */
  static async startSmartFlow(userId, flowType, initialData = {}, flowConfig = {}) {
    try {
      // حذف أي تدفق نشط سابق
      await this.clearFlow(userId);
      
      // إنشاء تدفق جديد
      const flow = {
        id: userId,
        flow: flowType,
        step: 1,
        totalSteps: flowConfig.totalSteps || 1,
        data: initialData,
        config: flowConfig,
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'active'
      };
      
      // حفظ في قاعدة البيانات
      await prisma.flowState.upsert({
        where: { id: userId },
        update: flow,
        create: flow
      });
      
      console.log(`🚀 Smart flow started: ${flowType} for user ${userId}`);
      return flow;
      
    } catch (error) {
      console.error('Error starting smart flow:', error);
      throw error;
    }
  }
  
  /**
   * الحصول على حالة التدفق الحالي
   * @param {string} userId - معرف المستخدم
   */
  static async getFlow(userId) {
    try {
      const flow = await prisma.flowState.findUnique({
        where: { id: userId }
      });
      
      if (!flow) {
        return null;
      }
      
      // التحقق من انتهاء صلاحية التدفق (30 دقيقة)
      const now = new Date();
      const flowAge = now - flow.updatedAt;
      const maxAge = 30 * 60 * 1000; // 30 دقيقة
      
      if (flowAge > maxAge) {
        await this.clearFlow(userId);
        return null;
      }
      
      return flow;
      
    } catch (error) {
      console.error('Error getting flow:', error);
      return null;
    }
  }
  
  /**
   * تحديث خطوة التدفق
   * @param {string} userId - معرف المستخدم
   * @param {number} step - رقم الخطوة الجديدة
   * @param {Object} data - البيانات الجديدة
   */
  static async updateStep(userId, step, data = {}) {
    try {
      const flow = await this.getFlow(userId);
      if (!flow) {
        throw new Error('No active flow found');
      }
      
      // إضافة الخطوة السابقة للتاريخ
      flow.history.push({
        step: flow.step,
        data: { ...flow.data },
        timestamp: new Date()
      });
      
      // تحديث التدفق
      const updatedFlow = {
        ...flow,
        step: step,
        data: { ...flow.data, ...data },
        updatedAt: new Date()
      };
      
      await prisma.flowState.update({
        where: { id: userId },
        data: updatedFlow
      });
      
      console.log(`📝 Flow updated: ${flow.flow} step ${step} for user ${userId}`);
      return updatedFlow;
      
    } catch (error) {
      console.error('Error updating flow step:', error);
      throw error;
    }
  }
  
  /**
   * تحديث بيانات التدفق
   * @param {string} userId - معرف المستخدم
   * @param {Object} data - البيانات الجديدة
   */
  static async updateData(userId, data) {
    try {
      const flow = await this.getFlow(userId);
      if (!flow) {
        throw new Error('No active flow found');
      }
      
      const updatedFlow = {
        ...flow,
        data: { ...flow.data, ...data },
        updatedAt: new Date()
      };
      
      await prisma.flowState.update({
        where: { id: userId },
        data: updatedFlow
      });
      
      return updatedFlow;
      
    } catch (error) {
      console.error('Error updating flow data:', error);
      throw error;
    }
  }
  
  /**
   * العودة للخطوة السابقة
   * @param {string} userId - معرف المستخدم
   */
  static async goBack(userId) {
    try {
      const flow = await this.getFlow(userId);
      if (!flow || flow.history.length === 0) {
        throw new Error('No previous step available');
      }
      
      // استرجاع الخطوة السابقة
      const previousStep = flow.history.pop();
      
      const updatedFlow = {
        ...flow,
        step: previousStep.step,
        data: previousStep.data,
        history: flow.history,
        updatedAt: new Date()
      };
      
      await prisma.flowState.update({
        where: { id: userId },
        data: updatedFlow
      });
      
      console.log(`⬅️ Flow went back: ${flow.flow} step ${previousStep.step} for user ${userId}`);
      return updatedFlow;
      
    } catch (error) {
      console.error('Error going back in flow:', error);
      throw error;
    }
  }
  
  /**
   * إنهاء التدفق
   * @param {string} userId - معرف المستخدم
   * @param {Object} finalData - البيانات النهائية
   */
  static async completeFlow(userId, finalData = {}) {
    try {
      const flow = await this.getFlow(userId);
      if (!flow) {
        throw new Error('No active flow found');
      }
      
      // تحديث البيانات النهائية
      const completedFlow = {
        ...flow,
        data: { ...flow.data, ...finalData },
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date()
      };
      
      await prisma.flowState.update({
        where: { id: userId },
        data: completedFlow
      });
      
      console.log(`✅ Flow completed: ${flow.flow} for user ${userId}`);
      return completedFlow;
      
    } catch (error) {
      console.error('Error completing flow:', error);
      throw error;
    }
  }
  
  /**
   * إلغاء التدفق
   * @param {string} userId - معرف المستخدم
   * @param {string} reason - سبب الإلغاء
   */
  static async cancelFlow(userId, reason = 'User cancelled') {
    try {
      const flow = await this.getFlow(userId);
      if (!flow) {
        return;
      }
      
      const cancelledFlow = {
        ...flow,
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
        updatedAt: new Date()
      };
      
      await prisma.flowState.update({
        where: { id: userId },
        data: cancelledFlow
      });
      
      console.log(`❌ Flow cancelled: ${flow.flow} for user ${userId} - ${reason}`);
      return cancelledFlow;
      
    } catch (error) {
      console.error('Error cancelling flow:', error);
      throw error;
    }
  }
  
  /**
   * مسح التدفق
   * @param {string} userId - معرف المستخدم
   */
  static async clearFlow(userId) {
    try {
      await prisma.flowState.delete({
        where: { id: userId }
      });
      
      console.log(`🗑️ Flow cleared for user ${userId}`);
      
    } catch (error) {
      console.error('Error clearing flow:', error);
    }
  }
  
  /**
   * التحقق من وجود تدفق نشط
   * @param {string} userId - معرف المستخدم
   */
  static async hasActiveFlow(userId) {
    try {
      const flow = await this.getFlow(userId);
      return flow && flow.status === 'active';
    } catch (error) {
      console.error('Error checking active flow:', error);
      return false;
    }
  }
  
  /**
   * الحصول على شريط التقدم
   * @param {number} currentStep - الخطوة الحالية
   * @param {number} totalSteps - إجمالي الخطوات
   */
  static getProgressBar(currentStep, totalSteps) {
    const progress = Math.round((currentStep / totalSteps) * 100);
    const filled = Math.round((currentStep / totalSteps) * 10);
    const empty = 10 - filled;
    
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `${bar} ${progress}% (${currentStep}/${totalSteps})`;
  }
  
  /**
   * إنشاء أزرار التنقل الذكية
   * @param {Object} options - خيارات الأزرار
   */
  static createSmartNavigation(options = {}) {
    const buttons = [];
    
    // زر العودة
    if (options.canGoBack) {
      buttons.push([Markup.button.callback('⬅️ Back', 'flow_back')]);
    }
    
    // زر الإلغاء
    if (options.canCancel) {
      buttons.push([Markup.button.callback('❌ Cancel', 'flow_cancel')]);
    }
    
    // زر المساعدة
    if (options.showHelp) {
      buttons.push([Markup.button.callback('❓ Help', 'flow_help')]);
    }
    
    return Markup.inlineKeyboard(buttons);
  }
  
  /**
   * التحقق من صحة البيانات
   * @param {string} flowType - نوع التدفق
   * @param {number} step - رقم الخطوة
   * @param {Object} data - البيانات للتحقق
   */
  static validateStepData(flowType, step, data) {
    const validators = {
      'wo_new': {
        1: (data) => data.typeOfWork && data.typeOfWork.length > 0,
        2: (data) => data.typeOfService && data.typeOfService.length > 0,
        3: (data) => data.priority && data.priority.length > 0,
        4: (data) => data.location && data.location.length >= 3,
        5: (data) => true, // Equipment is optional
        6: (data) => data.description && data.description.length >= 10
      },
      'reg_fac': {
        1: (data) => data.name && data.name.length >= 2 && data.name.length <= 60,
        2: (data) => data.city && data.city.length >= 2,
        3: (data) => data.phone && data.phone.length >= 10,
        4: (data) => data.plan && ['free', 'pro', 'business'].includes(data.plan.toLowerCase())
      }
    };
    
    const flowValidators = validators[flowType];
    if (!flowValidators) {
      return { valid: true, message: '' };
    }
    
    const stepValidator = flowValidators[step];
    if (!stepValidator) {
      return { valid: true, message: '' };
    }
    
    const isValid = stepValidator(data);
    if (!isValid) {
      return { 
        valid: false, 
        message: `Invalid data for step ${step} in flow ${flowType}` 
      };
    }
    
    return { valid: true, message: '' };
  }
  
  /**
   * إرسال إشعار للمستخدم
   * @param {Object} ctx - سياق Telegraf
   * @param {string} message - رسالة الإشعار
   * @param {string} type - نوع الإشعار (info, success, warning, error)
   */
  static async sendNotification(ctx, message, type = 'info') {
    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };
    
    const icon = icons[type] || 'ℹ️';
    
    try {
      await ctx.reply(`${icon} ${message}`);
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  }
}

module.exports = SmartFlowManager;
