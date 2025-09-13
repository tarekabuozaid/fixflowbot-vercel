/**
 * ============================================================================
 * SECURITY MANAGER - إدارة الأمان والتحقق
 * ============================================================================
 * 
 * هذا الملف يحتوي على جميع وظائف الأمان والتحقق في البوت
 * 
 * الميزات الرئيسية:
 * - تنظيف المدخلات من المستخدمين (XSS Protection)
 * - التحقق من هوية المستخدمين
 * - التحقق من صلاحيات الوصول
 * - Rate Limiting (تقييد معدل الطلبات)
 * - التحقق من صحة البيانات
 * 
 * تاريخ آخر تحديث: 31 أغسطس 2025
 * المطور: Tarek Abu Ozaid
 * ============================================================================
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ===== Rate Limiting Configuration =====
// تقييد معدل الطلبات لكل مستخدم (طلبات في الدقيقة)
const rateLimit = new Map();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 30;        // عدد الطلبات المسموحة
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 60000;  // نافذة الوقت (بالمللي ثانية)

class SecurityManager {
  /**
   * Sanitize user input to prevent XSS and injection attacks
   * @param {string} input - User input to sanitize
   * @param {number} maxLength - Maximum allowed length
   * @returns {string} Sanitized input
   */
  static sanitizeInput(input, maxLength = 1000) {
    if (!input || typeof input !== 'string') return '';
    
    // Remove null bytes and control characters
    let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');
    
    // Remove HTML tags
    sanitized = sanitized.replace(/<[^>]*>/g, '');
    
    // Remove script tags and dangerous patterns
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
    
    // Limit length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }
    
    return sanitized.trim();
  }

  /**
   * Authenticate and validate user
   * @param {Object} ctx - Telegram context
   * @returns {Object} User data and authentication status
   */
  static async authenticateUser(ctx) {
    try {
      // Validate Telegram user data
      if (!ctx.from || !ctx.from.id) {
        throw new Error('Invalid user data');
      }
      
      const userId = ctx.from.id;
      
      // Rate limiting check
      const now = Date.now();
      const userRateLimit = rateLimit.get(userId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
      
      if (now > userRateLimit.resetTime) {
        userRateLimit.count = 0;
        userRateLimit.resetTime = now + RATE_LIMIT_WINDOW;
      }
      
      if (userRateLimit.count >= RATE_LIMIT) {
        throw new Error('Rate limit exceeded');
      }
      
      userRateLimit.count++;
      rateLimit.set(userId, userRateLimit);
      
      // Get or create user from database
      const tgId = userId.toString();
      let user = await prisma.user.findUnique({ where: { tgId } });
      
      let isNew = false;
      
      if (!user) {
        // Create new user with sanitized data
        const firstName = this.sanitizeInput(ctx.from.first_name || '', 50);
        const lastName = this.sanitizeInput(ctx.from.last_name || '', 50);
        const username = this.sanitizeInput(ctx.from.username || '', 32);
        
        user = await prisma.user.create({
          data: { 
            tgId, 
            firstName: firstName || null,
            lastName: lastName || null,
            username: username || null,
            status: 'pending' 
          }
        });
        
        isNew = true;
        console.log(`🔐 New user created: ${userId} (${firstName || 'Unknown'})`);
      }
      
      return { user, isNew };
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  }

  /**
   * Validate facility access and permissions
   * @param {Object} ctx - Telegram context
   * @param {string} facilityId - Facility ID
   * @param {Array} requiredRoles - Required roles for access
   * @returns {Object} User, facility, and membership data
   */
  static async validateFacilityAccess(ctx, facilityId, requiredRoles = []) {
    try {
      const { user } = await this.authenticateUser(ctx);
      
      if (!facilityId) {
        throw new Error('Facility ID required');
      }
      
      // Validate facility ID format
      const facilityIdBigInt = BigInt(facilityId);
      
      // Check if facility exists and is active
      const facility = await prisma.facility.findUnique({
        where: { id: facilityIdBigInt }
      });
      
      if (!facility) {
        throw new Error('Facility not found');
      }
      
      if (facility.status !== 'active') {
        throw new Error('Facility is inactive');
      }
      
      // Check user membership
      const membership = await prisma.facilityMember.findFirst({
        where: { 
          userId: user.id, 
          facilityId: facilityIdBigInt,
          status: 'active'
        }
      });
      
      if (!membership) {
        throw new Error('User not a member of this facility');
      }
      
      // Check role requirements if specified
      if (requiredRoles.length > 0 && !requiredRoles.includes(membership.role)) {
        throw new Error('Insufficient permissions');
      }
      
      return { user, facility, membership };
    } catch (error) {
      console.error('Facility access validation error:', error);
      throw error;
    }
  }

  /**
   * Validate work order access and permissions
   * @param {Object} ctx - Telegram context
   * @param {string} workOrderId - Work order ID
   * @param {Array} requiredRoles - Required roles for access
   * @returns {Object} User, work order, and membership data
   */
  static async validateWorkOrderAccess(ctx, workOrderId, requiredRoles = []) {
    try {
      const { user } = await this.authenticateUser(ctx);
      
      if (!workOrderId) {
        throw new Error('Work order ID required');
      }
      
      // Validate work order ID format
      const workOrderIdBigInt = BigInt(workOrderId);
      
      // Get work order with facility info
      const workOrder = await prisma.workOrder.findUnique({
        where: { id: workOrderIdBigInt },
        include: { facility: true }
      });
      
      if (!workOrder) {
        throw new Error('Work order not found');
      }
      
      // Check user membership in the facility
      const membership = await prisma.facilityMember.findFirst({
        where: { 
          userId: user.id, 
          facilityId: workOrder.facilityId,
          status: 'active'
        }
      });
      
      if (!membership) {
        throw new Error('User not a member of this facility');
      }
      
      // Check role requirements if specified
      if (requiredRoles.length > 0 && !requiredRoles.includes(membership.role)) {
        throw new Error('Insufficient permissions for this operation');
      }
      
      return { user, workOrder, membership };
    } catch (error) {
      console.error('Work order access validation error:', error);
      throw error;
    }
  }

  /**
   * Validate master access
   * @param {Object} ctx - Telegram context
   * @returns {boolean} True if user is master
   */
  static validateMasterAccess(ctx) {
    const MASTER_ID = process.env.MASTER_ID || '';
    if (String(ctx.from?.id || '') !== String(MASTER_ID)) {
      throw new Error('Master access required');
    }
    return true;
  }

  /**
   * Input validation helpers
   */
  static validateEmail(email) {
    if (!email) return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) ? email : null;
  }

  static validatePhone(phone) {
    if (!phone) return null;
    const cleanPhone = phone.replace(/\D/g, '');
    return cleanPhone.length >= 7 && cleanPhone.length <= 15 ? cleanPhone : null;
  }

  static validateName(name) {
    if (!name) return null;
    const sanitized = this.sanitizeInput(name, 50);
    return sanitized.length >= 2 ? sanitized : null;
  }
}

module.exports = SecurityManager;
