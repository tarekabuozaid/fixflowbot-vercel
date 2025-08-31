/**
 * Service Errors - أخطاء الـ Services المشتركة
 * 
 * هذا الملف يحتوي على تعريفات الأخطاء المشتركة
 * بين جميع الـ Services
 */

class ServiceError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class ValidationError extends ServiceError {
  constructor(message, field = null) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class AuthenticationError extends ServiceError {
  constructor(message = 'Authentication required') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends ServiceError {
  constructor(message = 'Insufficient permissions') {
    super(message, 'AUTHORIZATION_ERROR', 403);
    this.name = 'AuthorizationError';
  }
}

class NotFoundError extends ServiceError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends ServiceError {
  constructor(message = 'Resource conflict') {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

class PlanLimitError extends ServiceError {
  constructor(message = 'Plan limit exceeded') {
    super(message, 'PLAN_LIMIT_EXCEEDED', 429);
    this.name = 'PlanLimitError';
  }
}

// دوال مساعدة لإنشاء الأخطاء
const createValidationError = (field, message) => {
  return new ValidationError(message, field);
};

const createNotFoundError = (resource) => {
  return new NotFoundError(resource);
};

const createConflictError = (message) => {
  return new ConflictError(message);
};

const createPlanLimitError = (limit, current, max) => {
  return new PlanLimitError(
    `${limit} limit exceeded. Current: ${current}, Maximum: ${max}`
  );
};

// معالجة الأخطاء المشتركة
const handleServiceError = (error) => {
  if (error instanceof ServiceError) {
    return {
      success: false,
      error: error.code,
      message: error.message,
      statusCode: error.statusCode
    };
  }
  
  // أخطاء قاعدة البيانات
  if (error.code && error.code.startsWith('P')) {
    return {
      success: false,
      error: 'DATABASE_ERROR',
      message: 'Database operation failed',
      statusCode: 500
    };
  }
  
  // أخطاء عامة
  return {
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    statusCode: 500
  };
};

module.exports = {
  ServiceError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  PlanLimitError,
  createValidationError,
  createNotFoundError,
  createConflictError,
  createPlanLimitError,
  handleServiceError
};
