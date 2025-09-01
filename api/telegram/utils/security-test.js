/**
 * ============================================================================
 * SECURITY MANAGER - إدارة الأمان والتحقق (نسخة الاختبار)
 * ============================================================================
 * 
 * نسخة مبسطة للاختبار بدون قاعدة البيانات
 */

// ===== Rate Limiting Configuration =====
const rateLimit = new Map();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 30;
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 60000;

class SecurityManagerTest {
  /**
   * Sanitize user input to prevent XSS and injection attacks
   * @param {string} input - User input to sanitize
   * @param {number} maxLength - Maximum allowed length
   * @returns {string} Sanitized input
   */
  static sanitizeInput(input, maxLength = 1000) {
    if (!input) return '';
    
    let sanitized = String(input)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[<>"\'/\\]/g, (char) => {
        const charMap = {
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#x27;',
          '/': '&#x2F;',
          '\\': '&#x5C;'
        };
        return charMap[char] || char;
      });
    
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }
    
    return sanitized.trim();
  }

  /**
   * Authenticate and validate user (mock version)
   * @param {Object} ctx - Telegram context
   * @returns {Object} User data and authentication status
   */
  static async authenticateUser(ctx) {
    try {
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
      
      // Mock user data
      const mockUser = {
        id: BigInt(userId),
        tgId: BigInt(userId),
        firstName: ctx.from.first_name || 'User',
        lastName: ctx.from.last_name || null,
        username: ctx.from.username || null,
        status: 'active',
        activeFacilityId: BigInt(1)
      };
      
      return { user: mockUser, isNew: false };
    } catch (error) {
      console.error('Authentication error:', error);
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

module.exports = SecurityManagerTest;