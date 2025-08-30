/**
 * Rate Limiting Middleware
 * 
 * This middleware implements rate limiting to prevent abuse
 * and ensure fair usage of the bot.
 */

const ErrorHandler = require('../utils/errorHandler');

// In-memory rate limit store (in production, use Redis)
const rateLimitStore = new Map();

// Default rate limit settings
const DEFAULT_RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 10; // requests per window
const DEFAULT_RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW) || 60000; // 1 minute in ms

/**
 * Clean up expired rate limit entries
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.timestamp > data.window) {
      rateLimitStore.delete(key);
    }
  }
}

// Clean up expired entries every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);

/**
 * Generate rate limit key for user
 */
function getRateLimitKey(userId, action = 'general') {
  return `${userId}:${action}`;
}

/**
 * Check if user has exceeded rate limit
 */
function checkRateLimit(userId, action = 'general', limit = DEFAULT_RATE_LIMIT, window = DEFAULT_RATE_LIMIT_WINDOW) {
  const key = getRateLimitKey(userId, action);
  const now = Date.now();
  
  const userData = rateLimitStore.get(key);
  
  if (!userData) {
    // First request
    rateLimitStore.set(key, {
      count: 1,
      timestamp: now,
      window: window
    });
    return { allowed: true, remaining: limit - 1, resetTime: now + window };
  }
  
  // Check if window has expired
  if (now - userData.timestamp > userData.window) {
    // Reset counter
    rateLimitStore.set(key, {
      count: 1,
      timestamp: now,
      window: window
    });
    return { allowed: true, remaining: limit - 1, resetTime: now + window };
  }
  
  // Check if limit exceeded
  if (userData.count >= limit) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetTime: userData.timestamp + userData.window,
      retryAfter: Math.ceil((userData.timestamp + userData.window - now) / 1000)
    };
  }
  
  // Increment counter
  userData.count++;
  rateLimitStore.set(key, userData);
  
  return { 
    allowed: true, 
    remaining: limit - userData.count, 
    resetTime: userData.timestamp + userData.window 
  };
}

/**
 * General rate limiting middleware
 */
function rateLimit(limit = DEFAULT_RATE_LIMIT, window = DEFAULT_RATE_LIMIT_WINDOW) {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        return ctx.reply('❌ User identification failed.');
      }

      const result = checkRateLimit(userId, 'general', limit, window);
      
      if (!result.allowed) {
        const retryAfter = Math.ceil(result.retryAfter / 60); // Convert to minutes
        return ctx.reply(
          `⏰ Rate limit exceeded. Please try again in ${retryAfter} minute${retryAfter > 1 ? 's' : ''}.\n\n` +
          `You can make ${limit} requests per ${Math.ceil(window / 60000)} minute${Math.ceil(window / 60000) > 1 ? 's' : ''}.`
        );
      }

      // Add rate limit info to context for debugging
      ctx.rateLimit = {
        remaining: result.remaining,
        resetTime: result.resetTime
      };

      await next();
    } catch (error) {
      ErrorHandler.handleError(ctx, error, 'rate_limit_middleware');
    }
  };
}

/**
 * Specific rate limiting for work order creation
 */
function workOrderRateLimit() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        return ctx.reply('❌ User identification failed.');
      }

      // Stricter limits for work order creation
      const result = checkRateLimit(userId, 'work_order_creation', 5, 300000); // 5 requests per 5 minutes
      
      if (!result.allowed) {
        const retryAfter = Math.ceil(result.retryAfter / 60);
        return ctx.reply(
          `⏰ Work order creation rate limit exceeded.\n\n` +
          `Please wait ${retryAfter} minute${retryAfter > 1 ? 's' : ''} before creating another work order.`
        );
      }

      await next();
    } catch (error) {
      ErrorHandler.handleError(ctx, error, 'work_order_rate_limit');
    }
  };
}

/**
 * Rate limiting for facility operations
 */
function facilityRateLimit() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        return ctx.reply('❌ User identification failed.');
      }

      // Moderate limits for facility operations
      const result = checkRateLimit(userId, 'facility_operations', 3, 600000); // 3 requests per 10 minutes
      
      if (!result.allowed) {
        const retryAfter = Math.ceil(result.retryAfter / 60);
        return ctx.reply(
          `⏰ Facility operation rate limit exceeded.\n\n` +
          `Please wait ${retryAfter} minute${retryAfter > 1 ? 's' : ''} before trying again.`
        );
      }

      await next();
    } catch (error) {
      ErrorHandler.handleError(ctx, error, 'facility_rate_limit');
    }
  };
}

/**
 * Rate limiting for admin operations
 */
function adminRateLimit() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        return ctx.reply('❌ User identification failed.');
      }

      // Higher limits for admin operations
      const result = checkRateLimit(userId, 'admin_operations', 20, 600000); // 20 requests per 10 minutes
      
      if (!result.allowed) {
        const retryAfter = Math.ceil(result.retryAfter / 60);
        return ctx.reply(
          `⏰ Admin operation rate limit exceeded.\n\n` +
          `Please wait ${retryAfter} minute${retryAfter > 1 ? 's' : ''} before trying again.`
        );
      }

      await next();
    } catch (error) {
      ErrorHandler.handleError(ctx, error, 'admin_rate_limit');
    }
  };
}

/**
 * Get rate limit statistics for a user
 */
function getRateLimitStats(userId) {
  const stats = {};
  
  // Check different rate limit categories
  const categories = ['general', 'work_order_creation', 'facility_operations', 'admin_operations'];
  
  categories.forEach(category => {
    const key = getRateLimitKey(userId, category);
    const data = rateLimitStore.get(key);
    
    if (data) {
      const now = Date.now();
      const timeLeft = Math.max(0, data.timestamp + data.window - now);
      
      stats[category] = {
        count: data.count,
        window: data.window,
        timeLeft: timeLeft,
        isExpired: timeLeft === 0
      };
    } else {
      stats[category] = {
        count: 0,
        window: 0,
        timeLeft: 0,
        isExpired: true
      };
    }
  });
  
  return stats;
}

/**
 * Reset rate limit for a user (admin function)
 */
function resetRateLimit(userId, action = null) {
  if (action) {
    const key = getRateLimitKey(userId, action);
    rateLimitStore.delete(key);
  } else {
    // Reset all rate limits for user
    for (const [key] of rateLimitStore.entries()) {
      if (key.startsWith(`${userId}:`)) {
        rateLimitStore.delete(key);
      }
    }
  }
}

module.exports = {
  rateLimit,
  workOrderRateLimit,
  facilityRateLimit,
  adminRateLimit,
  getRateLimitStats,
  resetRateLimit,
  checkRateLimit
};
