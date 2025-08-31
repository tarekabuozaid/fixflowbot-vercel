/**
 * Services Index - نقطة دخول للـ Services
 * 
 * هذا الملف يجمع جميع الـ Services في مكان واحد
 * لتسهيل الاستيراد والاستخدام
 */

const UserService = require('./userService');
const FacilityService = require('./facilityService');
const WorkOrderService = require('./workOrderService');
const PlanService = require('./planService');

module.exports = {
  UserService,
  FacilityService,
  WorkOrderService,
  PlanService
};
