/**
 * Middleware Index
 * 
 * This file exports all middleware functions for easy import
 */

const auth = require('./auth');
const rateLimit = require('./rateLimit');
const validation = require('./validation');

module.exports = {
  // Authentication middleware
  authenticateUser: auth.authenticateUser,
  requireRole: auth.requireRole,
  requireFacilityAdmin: auth.requireFacilityAdmin,
  requireSupervisor: auth.requireSupervisor,
  requireTechnician: auth.requireTechnician,
  requireFacilityAccess: auth.requireFacilityAccess,
  requireActiveFacility: auth.requireActiveFacility,
  requireMasterAccess: auth.requireMasterAccess,
  handleRegistrationFlow: auth.handleRegistrationFlow,

  // Rate limiting middleware
  rateLimit: rateLimit.rateLimit,
  workOrderRateLimit: rateLimit.workOrderRateLimit,
  facilityRateLimit: rateLimit.facilityRateLimit,
  adminRateLimit: rateLimit.adminRateLimit,
  getRateLimitStats: rateLimit.getRateLimitStats,
  resetRateLimit: rateLimit.resetRateLimit,
  checkRateLimit: rateLimit.checkRateLimit,

  // Validation middleware
  validateTextInput: validation.validateTextInput,
  validateWorkOrderInput: validation.validateWorkOrderInput,
  validateFacilityName: validation.validateFacilityName,
  validateEmail: validation.validateEmail,
  validatePhone: validation.validatePhone,
  validateName: validation.validateName,
  validateNumericInput: validation.validateNumericInput,
  validateCallbackData: validation.validateCallbackData,
  validateFlowData: validation.validateFlowData,
  validateFlowStepInput: validation.validateFlowStepInput
};
