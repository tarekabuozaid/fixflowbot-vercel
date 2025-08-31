/**
 * Validation Middleware
 * 
 * This middleware handles input validation and sanitization
 * for all bot interactions.
 */

const SecurityManager = require('../utils/security');
const ErrorHandler = require('../utils/errorHandler');

/**
 * Validate and sanitize text input
 */
function validateTextInput(maxLength = 1000, minLength = 1) {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text;
      if (!text) {
        return ctx.reply('❌ Please provide text input.');
      }

      // Sanitize input
      const sanitizedText = SecurityManager.sanitizeInput(text, maxLength);
      
      if (!sanitizedText || sanitizedText.length < minLength) {
        return ctx.reply(`❌ Input too short. Minimum ${minLength} character${minLength > 1 ? 's' : ''} required.`);
      }

      if (sanitizedText.length > maxLength) {
        return ctx.reply(`❌ Input too long. Maximum ${maxLength} characters allowed.`);
      }

      // Attach sanitized text to context
      ctx.sanitizedText = sanitizedText;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'text_validation');
    }
  };
}

/**
 * Validate work order input
 */
function validateWorkOrderInput() {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text;
      if (!text) {
        return ctx.reply('❌ Please provide work order details.');
      }

      // Sanitize input
      const sanitizedText = SecurityManager.sanitizeInput(text, 500);
      
      if (!sanitizedText || sanitizedText.length < 10) {
        return ctx.reply('❌ Work order description must be at least 10 characters long.');
      }

      if (sanitizedText.length > 500) {
        return ctx.reply('❌ Work order description too long. Maximum 500 characters allowed.');
      }

      // Check for common spam patterns
      const spamPatterns = [
        /(.)\1{10,}/, // Repeated characters
        /[A-Z]{20,}/, // All caps
        /[!@#$%^&*()]{10,}/, // Excessive symbols
        /\b(spam|test|fake|dummy)\b/i // Common spam words
      ];

      for (const pattern of spamPatterns) {
        if (pattern.test(sanitizedText)) {
          return ctx.reply('❌ Invalid input detected. Please provide a valid work order description.');
        }
      }

      ctx.sanitizedText = sanitizedText;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'work_order_validation');
    }
  };
}

/**
 * Validate facility name input
 */
function validateFacilityName() {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text;
      if (!text) {
        return ctx.reply('❌ Please provide a facility name.');
      }

      // Sanitize input
      const sanitizedText = SecurityManager.sanitizeInput(text, 100);
      
      if (!sanitizedText || sanitizedText.length < 2) {
        return ctx.reply('❌ Facility name must be at least 2 characters long.');
      }

      if (sanitizedText.length > 100) {
        return ctx.reply('❌ Facility name too long. Maximum 100 characters allowed.');
      }

      // Validate facility name format
      const facilityNamePattern = /^[a-zA-Z0-9\s\-_\.]+$/;
      if (!facilityNamePattern.test(sanitizedText)) {
        return ctx.reply('❌ Facility name contains invalid characters. Use only letters, numbers, spaces, hyphens, underscores, and dots.');
      }

      ctx.sanitizedText = sanitizedText;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'facility_name_validation');
    }
  };
}

/**
 * Validate email input
 */
function validateEmail() {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text;
      if (!text) {
        return ctx.reply('❌ Please provide an email address.');
      }

      // Sanitize input
      const sanitizedText = SecurityManager.sanitizeInput(text, 100);
      
      if (!sanitizedText) {
        return ctx.reply('❌ Please provide a valid email address.');
      }

      // Validate email format
      const isValidEmail = SecurityManager.validateEmail(sanitizedText);
      if (!isValidEmail) {
        return ctx.reply('❌ Please provide a valid email address format (e.g., user@example.com).');
      }

      ctx.sanitizedText = sanitizedText;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'email_validation');
    }
  };
}

/**
 * Validate phone number input
 */
function validatePhone() {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text;
      if (!text) {
        return ctx.reply('❌ Please provide a phone number.');
      }

      // Sanitize input
      const sanitizedText = SecurityManager.sanitizeInput(text, 20);
      
      if (!sanitizedText) {
        return ctx.reply('❌ Please provide a valid phone number.');
      }

      // Validate phone format
      const isValidPhone = SecurityManager.validatePhone(sanitizedText);
      if (!isValidPhone) {
        return ctx.reply('❌ Please provide a valid phone number format (e.g., +1234567890 or 123-456-7890).');
      }

      ctx.sanitizedText = sanitizedText;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'phone_validation');
    }
  };
}

/**
 * Validate name input
 */
function validateName() {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text;
      if (!text) {
        return ctx.reply('❌ Please provide a name.');
      }

      // Sanitize input
      const sanitizedText = SecurityManager.sanitizeInput(text, 50);
      
      if (!sanitizedText || sanitizedText.length < 2) {
        return ctx.reply('❌ Name must be at least 2 characters long.');
      }

      if (sanitizedText.length > 50) {
        return ctx.reply('❌ Name too long. Maximum 50 characters allowed.');
      }

      // Validate name format
      const isValidName = SecurityManager.validateName(sanitizedText);
      if (!isValidName) {
        return ctx.reply('❌ Name contains invalid characters. Use only letters, spaces, hyphens, and apostrophes.');
      }

      ctx.sanitizedText = sanitizedText;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'name_validation');
    }
  };
}

/**
 * Validate numeric input
 */
function validateNumericInput(min = 0, max = 999999) {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text;
      if (!text) {
        return ctx.reply('❌ Please provide a number.');
      }

      // Sanitize input
      const sanitizedText = SecurityManager.sanitizeInput(text, 10);
      
      if (!sanitizedText) {
        return ctx.reply('❌ Please provide a valid number.');
      }

      // Check if it's a valid number
      const number = parseInt(sanitizedText);
      if (isNaN(number)) {
        return ctx.reply('❌ Please provide a valid number.');
      }

      if (number < min || number > max) {
        return ctx.reply(`❌ Number must be between ${min} and ${max}.`);
      }

      ctx.numericValue = number;
      ctx.sanitizedText = sanitizedText;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'numeric_validation');
    }
  };
}

/**
 * Validate callback data
 */
function validateCallbackData() {
  return async (ctx, next) => {
    try {
      const callbackData = ctx.callbackQuery?.data;
      if (!callbackData) {
        return ctx.reply('❌ Invalid callback data.');
      }

      // Sanitize callback data
      const sanitizedData = SecurityManager.sanitizeInput(callbackData, 100);
      
      if (!sanitizedData) {
        return ctx.reply('❌ Invalid callback data.');
      }

      // Validate callback data format
      const callbackPattern = /^[a-zA-Z0-9_|]+$/;
      if (!callbackPattern.test(sanitizedData)) {
        return ctx.reply('❌ Invalid callback data format.');
      }

      ctx.sanitizedCallbackData = sanitizedData;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'callback_validation');
    }
  };
}

/**
 * Validate flow data
 */
function validateFlowData() {
  return async (ctx, next) => {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        return ctx.reply('❌ User identification failed.');
      }

      // Check if user has active flow
      const FlowManager = require('../utils/flowManager');
      const flowState = FlowManager.getFlow(userId);
      
      if (!flowState) {
        return ctx.reply('❌ No active flow found. Please start over.');
      }

      // Validate flow ownership
      const isValidOwner = FlowManager.validateFlowOwnership(userId, flowState);
      if (!isValidOwner) {
        return ctx.reply('❌ Flow ownership validation failed.');
      }

      ctx.flowState = flowState;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'flow_validation');
    }
  };
}

/**
 * Validate user input based on flow step
 */
function validateFlowStepInput() {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text;
      if (!text) {
        return ctx.reply('❌ Please provide input.');
      }

      const flowState = ctx.flowState;
      if (!flowState) {
        return ctx.reply('❌ No active flow found.');
      }

      let isValid = true;
      let errorMessage = '';

      // Validate based on flow type and step
      switch (flowState.flow) {
        case 'user_registration':
          switch (flowState.step) {
            case 2: // Name
              isValid = SecurityManager.validateName(text);
              errorMessage = '❌ Invalid name format.';
              break;
            case 3: // Email
              isValid = SecurityManager.validateEmail(text);
              errorMessage = '❌ Invalid email format.';
              break;
            case 4: // Phone
              isValid = SecurityManager.validatePhone(text);
              errorMessage = '❌ Invalid phone format.';
              break;
          }
          break;

        case 'facility_registration':
          switch (flowState.step) {
            case 2: // Facility name
              isValid = /^[a-zA-Z0-9\s\-_\.]+$/.test(text);
              errorMessage = '❌ Invalid facility name format.';
              break;
            case 3: // Plan selection
              isValid = ['free', 'pro', 'business'].includes(text.toLowerCase());
              errorMessage = '❌ Invalid plan selection.';
              break;
          }
          break;

        case 'wo_new':
          switch (flowState.step) {
            case 4: // Location
              isValid = text.length >= 2 && text.length <= 100;
              errorMessage = '❌ Location must be 2-100 characters.';
              break;
            case 5: // Equipment (optional)
              isValid = text.toLowerCase() === 'skip' || (text.length >= 1 && text.length <= 100);
              errorMessage = '❌ Equipment must be 1-100 characters or "skip".';
              break;
            case 6: // Description
              isValid = text.length >= 10 && text.length <= 500;
              errorMessage = '❌ Description must be 10-500 characters.';
              break;
          }
          break;
      }

      if (!isValid) {
        return ctx.reply(errorMessage);
      }

      // Sanitize input
      const sanitizedText = SecurityManager.sanitizeInput(text, 500);
      ctx.sanitizedText = sanitizedText;
      
      await next();
    } catch (error) {
      ErrorHandler.handleValidationError(ctx, error, 'flow_step_validation');
    }
  };
}

module.exports = {
  validateTextInput,
  validateWorkOrderInput,
  validateFacilityName,
  validateEmail,
  validatePhone,
  validateName,
  validateNumericInput,
  validateCallbackData,
  validateFlowData,
  validateFlowStepInput
};
