/**
 * Controllers Index - نقطة دخول للـ Controllers
 * 
 * هذا الملف يجمع جميع الـ Controllers في مكان واحد
 * لتسهيل الاستيراد والاستخدام
 */

const UserController = require('./userController');
const FacilityController = require('./facilityController');
const WorkOrderController = require('./workOrderController');

module.exports = {
  UserController,
  FacilityController,
  WorkOrderController
};
