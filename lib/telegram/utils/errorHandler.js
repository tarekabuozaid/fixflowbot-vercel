/**
 * Centralized Error Handler for FixFlow Bot
 */

class ErrorHandler {
  /**
   * Handle errors with appropriate user messages
   * @param {Error} error - Error object
   * @param {Object} ctx - Telegram context
   * @param {string} operation - Operation name for logging
   * @returns {Promise<void>}
   */
  static async handleError(error, ctx, operation = 'Unknown') {
    const userId = ctx.from?.id || 'unknown';
    const username = ctx.from?.username || 'unknown';
    const chatId = ctx.chat?.id || 'unknown';
    
    // Log error details
    console.error(`🚨 Error in ${operation} - User: ${userId} (@${username}), Chat: ${chatId}`, error);
    
    // Determine error type and send appropriate message
    let userMessage = '⚠️ An error occurred. Please try again.';
    let shouldLogSecurity = false;
    
    if (error.message.includes('Rate limit exceeded')) {
      userMessage = '⚠️ Too many requests. Please wait a moment and try again.';
      shouldLogSecurity = true;
    } else if (error.message.includes('Invalid user data')) {
      userMessage = '⚠️ Invalid user data. Please restart the bot.';
      shouldLogSecurity = true;
    } else if (error.message.includes('Insufficient permissions')) {
      userMessage = '⚠️ You need admin privileges for this action.';
      shouldLogSecurity = true;
    } else if (error.message.includes('Facility not found')) {
      userMessage = '⚠️ Facility not found. Please contact support.';
    } else if (error.message.includes('Work order not found')) {
      userMessage = '⚠️ Work order not found.';
    } else if (error.message.includes('User not a member')) {
      userMessage = '⚠️ You are not a member of this facility.';
    } else if (error.message.includes('limit exceeded')) {
      userMessage = `⚠️ **Plan Limit Exceeded**\n\n${error.message}\n\nPlease contact the facility administrator to upgrade the plan.`;
    } else if (error.message.includes('Master access required')) {
      userMessage = '🚫 Only master can perform this action.';
      shouldLogSecurity = true;
    } else if (error.message.includes('Session expired')) {
      userMessage = '⚠️ Session expired. Please start over.';
    } else if (error.message.includes('Invalid input')) {
      userMessage = '⚠️ Invalid input. Please check your data and try again.';
    }
    
    // Log security events
    if (shouldLogSecurity) {
      console.warn(`🔒 Security Event - User ${userId} attempted unauthorized access in ${operation}`);
    }
    
    // Send error message to user
    try {
      await ctx.reply(userMessage);
    } catch (replyError) {
      console.error('Failed to send error message to user:', replyError);
    }
  }

  /**
   * Handle authentication errors specifically
   * @param {Error} error - Authentication error
   * @param {Object} ctx - Telegram context
   * @returns {Promise<void>}
   */
  static async handleAuthError(error, ctx) {
    const userId = ctx.from?.id || 'unknown';
    
    console.error(`🔐 Authentication Error - User: ${userId}`, error);
    
    let userMessage = '⚠️ Authentication failed. Please try again.';
    
    if (error.message.includes('Rate limit exceeded')) {
      userMessage = '⚠️ Too many requests. Please wait a moment and try again.';
    } else if (error.message.includes('Invalid user data')) {
      userMessage = '⚠️ Invalid user data. Please restart the bot.';
    }
    
    try {
      await ctx.reply(userMessage);
    } catch (replyError) {
      console.error('Failed to send auth error message:', replyError);
    }
  }

  /**
   * Handle validation errors
   * @param {Error} error - Validation error
   * @param {Object} ctx - Telegram context
   * @param {string} field - Field that failed validation
   * @returns {Promise<void>}
   */
  static async handleValidationError(error, ctx, field = 'input') {
    const userId = ctx.from?.id || 'unknown';
    
    console.error(`📝 Validation Error - User: ${userId}, Field: ${field}`, error);
    
    let userMessage = `⚠️ Invalid ${field}. Please check your input and try again.`;
    
    if (error.message.includes('must be at least')) {
      userMessage = `⚠️ ${field} is too short. Please provide more details.`;
    } else if (error.message.includes('already exists')) {
      userMessage = `⚠️ ${field} already exists. Please choose a different value.`;
    } else if (error.message.includes('Invalid email')) {
      userMessage = '⚠️ Invalid email format. Please enter a valid email address.';
    } else if (error.message.includes('Invalid phone')) {
      userMessage = '⚠️ Invalid phone format. Please enter a valid phone number.';
    }
    
    try {
      await ctx.reply(userMessage);
    } catch (replyError) {
      console.error('Failed to send validation error message:', replyError);
    }
  }

  /**
   * Handle database errors
   * @param {Error} error - Database error
   * @param {Object} ctx - Telegram context
   * @param {string} operation - Database operation
   * @returns {Promise<void>}
   */
  static async handleDatabaseError(error, ctx, operation = 'database operation') {
    const userId = ctx.from?.id || 'unknown';
    
    console.error(`🗄️ Database Error in ${operation} - User: ${userId}`, error);
    
    let userMessage = '⚠️ Database error occurred. Please try again later.';
    
    if (error.code === 'P2002') {
      userMessage = '⚠️ This record already exists. Please use a different value.';
    } else if (error.code === 'P2003') {
      userMessage = '⚠️ Invalid data provided. Please check your information.';
    } else if (error.code === 'P2025') {
      userMessage = '⚠️ Record not found. It may have been deleted.';
    } else if (error.code === 'P2024') {
      userMessage = '⚠️ Database connection timeout. Please try again.';
    }
    
    try {
      await ctx.reply(userMessage);
    } catch (replyError) {
      console.error('Failed to send database error message:', replyError);
    }
  }

  /**
   * Handle flow errors
   * @param {Error} error - Flow error
   * @param {Object} ctx - Telegram context
   * @param {string} flowType - Type of flow
   * @returns {Promise<void>}
   */
  static async handleFlowError(error, ctx, flowType = 'flow') {
    const userId = ctx.from?.id || 'unknown';
    
    console.error(`🔄 Flow Error in ${flowType} - User: ${userId}`, error);
    
    let userMessage = '⚠️ Flow error occurred. Please start over.';
    
    if (error.message.includes('Session expired')) {
      userMessage = '⚠️ Session expired. Please start over.';
    } else if (error.message.includes('Invalid flow')) {
      userMessage = '⚠️ Invalid flow state. Please restart the process.';
    } else if (error.message.includes('Flow ownership')) {
      userMessage = '⚠️ Session conflict. Please start over.';
    }
    
    try {
      await ctx.reply(userMessage, {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]]
        }
      });
    } catch (replyError) {
      console.error('Failed to send flow error message:', replyError);
    }
  }

  /**
   * Handle plan limit errors
   * @param {Error} error - Plan limit error
   * @param {Object} ctx - Telegram context
   * @returns {Promise<void>}
   */
  static async handlePlanLimitError(error, ctx) {
    const userId = ctx.from?.id || 'unknown';
    
    console.error(`📊 Plan Limit Error - User: ${userId}`, error);
    
    const userMessage = `⚠️ **Plan Limit Exceeded**\n\n${error.message}\n\nPlease contact the facility administrator to upgrade the plan.`;
    
    try {
      await ctx.reply(userMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'back_to_menu' }]]
        }
      });
    } catch (replyError) {
      console.error('Failed to send plan limit error message:', replyError);
    }
  }

  /**
   * Safe execution wrapper
   * @param {Function} operation - Operation to execute
   * @param {Object} ctx - Telegram context
   * @param {string} operationName - Name of operation for logging
   * @returns {Promise<any>} Operation result
   */
  static async safeExecute(operation, ctx, operationName = 'operation') {
    try {
      return await operation();
    } catch (error) {
      await this.handleError(error, ctx, operationName);
      return null;
    }
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  static getErrorStats() {
    // This could be enhanced with actual error tracking
    return {
      totalErrors: 0,
      authErrors: 0,
      validationErrors: 0,
      databaseErrors: 0,
      flowErrors: 0,
      planLimitErrors: 0
    };
  }

  /**
   * Log error for analytics
   * @param {Error} error - Error object
   * @param {Object} ctx - Telegram context
   * @param {string} operation - Operation name
   */
  static logErrorForAnalytics(error, ctx, operation) {
    const errorData = {
      timestamp: new Date().toISOString(),
      userId: ctx.from?.id || 'unknown',
      username: ctx.from?.username || 'unknown',
      chatId: ctx.chat?.id || 'unknown',
      operation,
      errorMessage: error.message,
      errorStack: error.stack,
      errorType: this.getErrorType(error)
    };
    
    // Log to console for now, could be sent to external service
    console.log('📊 Error Analytics:', JSON.stringify(errorData, null, 2));
  }

  /**
   * Determine error type
   * @param {Error} error - Error object
   * @returns {string} Error type
   */
  static getErrorType(error) {
    if (error.message.includes('Rate limit')) return 'RATE_LIMIT';
    if (error.message.includes('Invalid user')) return 'AUTH';
    if (error.message.includes('Insufficient permissions')) return 'PERMISSION';
    if (error.message.includes('Facility not found')) return 'NOT_FOUND';
    if (error.message.includes('limit exceeded')) return 'PLAN_LIMIT';
    if (error.message.includes('Session expired')) return 'FLOW';
    if (error.message.includes('Invalid input')) return 'VALIDATION';
    if (error.code && error.code.startsWith('P')) return 'DATABASE';
    return 'UNKNOWN';
  }
}

module.exports = ErrorHandler;
