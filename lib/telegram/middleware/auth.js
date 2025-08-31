/**
 * Authentication Middleware
 * 
 * This middleware handles user authentication and authorization
 * for all bot interactions.
 */

const { UserService } = require('../services');
const SecurityManager = require('../utils/security');
const ErrorHandler = require('../utils/errorHandler');

/**
 * Middleware to authenticate user and attach user data to context
 */
async function authenticateUser(ctx, next) {
  try {
    // Get user from Telegram context
    const telegramUser = ctx.from;
    if (!telegramUser) {
      return ctx.reply('❌ Authentication failed. Please try again.');
    }

    // Get or create user from database
    const userResult = await UserService.getUserByTgId(telegramUser.id.toString());
    
    if (!userResult.success) {
      // User doesn't exist, redirect to registration
      ctx.session = { needsRegistration: true };
      return ctx.reply(
        '👋 Welcome! Please register to use the bot.\n\n' +
        'Use /register to get started.',
        { parse_mode: 'Markdown' }
      );
    }

    // Attach user data to context
    ctx.user = userResult.user;
    ctx.session = { 
      userId: userResult.user.id,
      tgId: userResult.user.tgId,
      needsRegistration: false 
    };

    // Continue to next middleware/handler
    await next();
  } catch (error) {
    ErrorHandler.handleAuthError(ctx, error, 'authentication_middleware');
  }
}

/**
 * Middleware to check if user has required role for facility
 */
function requireRole(requiredRoles) {
  return async (ctx, next) => {
    try {
      if (!ctx.user) {
        return ctx.reply('❌ Authentication required. Please try again.');
      }

      // Get facility from context or query
      const facilityId = ctx.match?.[1] || ctx.callbackQuery?.data?.split('|')[1];
      
      if (!facilityId) {
        return ctx.reply('❌ Facility ID not found.');
      }

      // Validate facility access
      const { user, facility, membership } = await SecurityManager.validateFacilityAccess(
        ctx, 
        facilityId, 
        requiredRoles
      );

      // Attach facility data to context
      ctx.facility = facility;
      ctx.membership = membership;

      await next();
    } catch (error) {
      ErrorHandler.handleAuthError(ctx, error, 'role_authorization');
    }
  };
}

/**
 * Middleware to check if user is facility admin
 */
const requireFacilityAdmin = requireRole(['facility_admin']);

/**
 * Middleware to check if user is supervisor or admin
 */
const requireSupervisor = requireRole(['facility_admin', 'supervisor']);

/**
 * Middleware to check if user is technician or higher
 */
const requireTechnician = requireRole(['facility_admin', 'supervisor', 'technician']);

/**
 * Middleware to check if user has any facility access
 */
const requireFacilityAccess = requireRole(['facility_admin', 'supervisor', 'technician', 'user']);

/**
 * Middleware to check if user has active facility
 */
async function requireActiveFacility(ctx, next) {
  try {
    if (!ctx.user) {
      return ctx.reply('❌ Authentication required. Please try again.');
    }

    if (!ctx.user.activeFacilityId) {
      return ctx.reply(
        '❌ You need to be connected to a facility.\n\n' +
        'Please join a facility first.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
    }

    await next();
  } catch (error) {
    ErrorHandler.handleAuthError(ctx, error, 'active_facility_check');
  }
}

/**
 * Middleware to check if user is master admin
 */
async function requireMasterAccess(ctx, next) {
  try {
    if (!ctx.user) {
      return ctx.reply('❌ Authentication required. Please try again.');
    }

    const isMaster = await SecurityManager.validateMasterAccess(ctx);
    if (!isMaster) {
      return ctx.reply('❌ Master access required.');
    }

    await next();
  } catch (error) {
    ErrorHandler.handleAuthError(ctx, error, 'master_access_check');
  }
}

/**
 * Middleware to handle registration flow
 */
async function handleRegistrationFlow(ctx, next) {
  try {
    // Check if user needs registration
    if (ctx.session?.needsRegistration) {
      // Allow registration commands
      if (ctx.message?.text === '/register' || ctx.message?.text === '/start') {
        return await next();
      }
      
      return ctx.reply(
        '👋 Please register to use the bot.\n\n' +
        'Use /register to get started.',
        { parse_mode: 'Markdown' }
      );
    }

    await next();
  } catch (error) {
    ErrorHandler.handleAuthError(ctx, error, 'registration_flow');
  }
}

module.exports = {
  authenticateUser,
  requireRole,
  requireFacilityAdmin,
  requireSupervisor,
  requireTechnician,
  requireFacilityAccess,
  requireActiveFacility,
  requireMasterAccess,
  handleRegistrationFlow
};
