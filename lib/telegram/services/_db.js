/**
 * Database Service - خدمة قاعدة البيانات المشتركة
 * 
 * هذا الملف يحتوي على إعدادات قاعدة البيانات المشتركة
 * بين جميع الـ Services
 */

const { PrismaClient } = require('@prisma/client');

// إنشاء instance واحد من Prisma للاستخدام المشترك
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
});

// التحقق من الاتصال بقاعدة البيانات
async function checkConnection() {
  try {
    await prisma.$connect();
    console.log('✅ Database connection established');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

// إغلاق الاتصال بقاعدة البيانات
async function disconnect() {
  try {
    await prisma.$disconnect();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error closing database connection:', error);
  }
}

// معالجة الأخطاء المشتركة
function handleDatabaseError(error, operation = 'database operation') {
  console.error(`❌ Database error in ${operation}:`, error);
  
  if (error.code === 'P2002') {
    return {
      success: false,
      error: 'DUPLICATE_ENTRY',
      message: 'A record with this information already exists'
    };
  }
  
  if (error.code === 'P2025') {
    return {
      success: false,
      error: 'RECORD_NOT_FOUND',
      message: 'The requested record was not found'
    };
  }
  
  if (error.code === 'P2003') {
    return {
      success: false,
      error: 'FOREIGN_KEY_CONSTRAINT',
      message: 'Cannot perform this operation due to related records'
    };
  }
  
  return {
    success: false,
    error: 'DATABASE_ERROR',
    message: 'An unexpected database error occurred'
  };
}

module.exports = {
  prisma,
  checkConnection,
  disconnect,
  handleDatabaseError
};
