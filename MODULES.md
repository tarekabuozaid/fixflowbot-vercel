# 🔧 وحدات FixFlow Bot - دليل المطور

## 📋 نظرة عامة

تم تطوير FixFlow Bot باستخدام بنية وحدات (Modular Architecture) لضمان قابلية الصيانة والتطوير. كل وحدة مسؤولة عن جانب محدد من وظائف البوت.

## 🏗️ البنية الوحداتية

```
utils/
├── security.js       # إدارة الأمان والتحقق
├── flowManager.js    # إدارة الفلوهات التفاعلية
├── planManager.js    # إدارة خطط الاشتراك
└── errorHandler.js   # معالجة الأخطاء المركزية
```

## 🔐 SecurityManager

### الوظائف الرئيسية
إدارة جميع جوانب الأمان والتحقق من المستخدمين والصلاحيات.

### الاستيراد
```javascript
const SecurityManager = require('./utils/security');
```

### الدوال المتاحة

#### `sanitizeInput(input, maxLength = 1000)`
تنقية المدخلات لمنع الهجمات.

```javascript
const sanitized = SecurityManager.sanitizeInput('<script>alert("xss")</script>Hello', 50);
// النتيجة: 'alert("xss")Hello'
```

#### `authenticateUser(ctx)`
التحقق من المستخدم وإنشاؤه إذا لم يكن موجوداً.

```javascript
const { user, isNew } = await SecurityManager.authenticateUser(ctx);
// user: بيانات المستخدم
// isNew: true إذا كان المستخدم جديد
```

#### `validateFacilityAccess(ctx, facilityId, requiredRoles = [])`
التحقق من صلاحيات الوصول للمنشأة.

```javascript
const { user, facility, membership } = await SecurityManager.validateFacilityAccess(
  ctx, 
  facilityId, 
  ['facility_admin', 'supervisor']
);
```

#### `validateWorkOrderAccess(ctx, workOrderId, requiredRoles = [])`
التحقق من صلاحيات الوصول لبلاغ معين.

```javascript
const { user, workOrder, membership } = await SecurityManager.validateWorkOrderAccess(
  ctx, 
  workOrderId, 
  ['facility_admin', 'supervisor']
);
```

#### `validateMasterAccess(ctx)`
التحقق من صلاحيات الماستر.

```javascript
SecurityManager.validateMasterAccess(ctx);
// يرمي خطأ إذا لم يكن المستخدم ماستر
```

#### `validateEmail(email)`
التحقق من صحة البريد الإلكتروني.

```javascript
const validEmail = SecurityManager.validateEmail('test@example.com');
// النتيجة: 'test@example.com' أو null
```

#### `validatePhone(phone)`
التحقق من صحة رقم الهاتف.

```javascript
const validPhone = SecurityManager.validatePhone('1234567890');
// النتيجة: '1234567890' أو null
```

#### `validateName(name)`
التحقق من صحة الاسم.

```javascript
const validName = SecurityManager.validateName('John Doe');
// النتيجة: 'John Doe' أو null
```

## 🔄 FlowManager

### الوظائف الرئيسية
إدارة الفلوهات التفاعلية للمستخدمين مع انتهاء صلاحية تلقائي.

### الاستيراد
```javascript
const FlowManager = require('./utils/flowManager');
```

### الدوال المتاحة

#### `setFlow(userId, flow, step, data)`
إنشاء فلوه جديد.

```javascript
FlowManager.setFlow('123456789', 'wo_new', 1, {
  facilityId: '1',
  type: 'maintenance'
});
```

#### `getFlow(userId)`
الحصول على فلوه المستخدم.

```javascript
const flow = FlowManager.getFlow('123456789');
// النتيجة: { flow: 'wo_new', step: 1, data: {...}, userId: '123456789', timestamp: 1234567890 }
```

#### `updateStep(userId, step)`
تحديث خطوة الفلوه.

```javascript
FlowManager.updateStep('123456789', 2);
```

#### `updateData(userId, newData)`
تحديث بيانات الفلوه.

```javascript
FlowManager.updateData('123456789', { 
  location: 'Building A',
  priority: 'high' 
});
```

#### `clearFlow(userId)`
مسح فلوه المستخدم.

```javascript
FlowManager.clearFlow('123456789');
```

#### `hasActiveFlow(userId)`
التحقق من وجود فلوه نشط.

```javascript
const hasFlow = FlowManager.hasActiveFlow('123456789');
// النتيجة: true أو false
```

#### `validateFlowOwnership(userId, flowState)`
التحقق من ملكية الفلوه.

```javascript
const isValid = FlowManager.validateFlowOwnership('123456789', flowState);
// النتيجة: true أو false
```

#### `getFlowStats()`
الحصول على إحصائيات الفلوهات.

```javascript
const stats = FlowManager.getFlowStats();
// النتيجة: { total: 5, active: 3, expired: 2, flowTypes: {...} }
```

#### `cleanupExpiredFlows()`
تنظيف الفلوهات المنتهية الصلاحية.

```javascript
FlowManager.cleanupExpiredFlows();
// يتم تشغيلها تلقائياً كل 30 دقيقة
```

## 📊 PlanManager

### الوظائف الرئيسية
إدارة خطط الاشتراك والحدود لكل منشأة.

### الاستيراد
```javascript
const PlanManager = require('./utils/planManager');
```

### الدوال المتاحة

#### `checkPlanLimit(facilityId, action, count = 1)`
التحقق من حدود الخطة.

```javascript
await PlanManager.checkPlanLimit(facilityId, 'workOrders', 1);
// يرمي خطأ إذا تم تجاوز الحد
```

#### `getPlanInfo(facilityId)`
الحصول على معلومات خطة المنشأة.

```javascript
const planInfo = await PlanManager.getPlanInfo(facilityId);
// النتيجة: { plan: 'Pro', limits: {...}, usage: {...} }
```

#### `getAvailablePlans()`
الحصول على الخطط المتاحة.

```javascript
const plans = PlanManager.getAvailablePlans();
// النتيجة: ['Free', 'Pro', 'Business']
```

#### `getPlanComparison(currentPlan, targetPlan)`
مقارنة بين خطتين.

```javascript
const comparison = PlanManager.getPlanComparison('Free', 'Pro');
// النتيجة: { improvements: {...} }
```

#### `upgradePlan(facilityId, newPlan)`
ترقية خطة المنشأة.

```javascript
await PlanManager.upgradePlan(facilityId, 'Pro');
```

#### `getPlanWarnings(facilityId)`
الحصول على تحذيرات الخطة.

```javascript
const warnings = await PlanManager.getPlanWarnings(facilityId);
// النتيجة: ['workOrders: 80% used', 'members: 90% used']
```

#### `getGlobalPlanStats()`
الحصول على إحصائيات عالمية للخطط.

```javascript
const stats = await PlanManager.getGlobalPlanStats();
// النتيجة: { totalFacilities: 50, planDistribution: {...} }
```

### حدود الخطط

#### Free Plan
```javascript
{
  members: 5,
  workOrders: 50,
  reports: 3,
  reminders: 10
}
```

#### Pro Plan
```javascript
{
  members: 20,
  workOrders: 200,
  reports: 15,
  reminders: 50
}
```

#### Business Plan
```javascript
{
  members: 100,
  workOrders: 1000,
  reports: 100,
  reminders: 200
}
```

## 🚨 ErrorHandler

### الوظائف الرئيسية
معالجة الأخطاء المركزية مع تسجيل وتصنيف الأخطاء.

### الاستيراد
```javascript
const ErrorHandler = require('./utils/errorHandler');
```

### الدوال المتاحة

#### `safeExecute(operation, ctx, operationName)`
تنفيذ آمن للعمليات مع معالجة الأخطاء.

```javascript
return ErrorHandler.safeExecute(async () => {
  // الكود هنا
  const result = await someOperation();
  return result;
}, ctx, 'create_work_order');
```

#### `handleError(error, ctx, context)`
معالجة خطأ معين.

```javascript
ErrorHandler.handleError(error, ctx, 'database_operation');
```

#### `handleAuthError(error, ctx)`
معالجة أخطاء المصادقة.

```javascript
ErrorHandler.handleAuthError(error, ctx);
```

#### `handleValidationError(error, ctx)`
معالجة أخطاء التحقق.

```javascript
ErrorHandler.handleValidationError(error, ctx);
```

#### `handleDatabaseError(error, ctx)`
معالجة أخطاء قاعدة البيانات.

```javascript
ErrorHandler.handleDatabaseError(error, ctx);
```

#### `handleFlowError(error, ctx)`
معالجة أخطاء الفلوهات.

```javascript
ErrorHandler.handleFlowError(error, ctx);
```

#### `handlePlanLimitError(error, ctx)`
معالجة أخطاء حدود الخطة.

```javascript
ErrorHandler.handlePlanLimitError(error, ctx);
```

#### `getErrorStats()`
الحصول على إحصائيات الأخطاء.

```javascript
const stats = ErrorHandler.getErrorStats();
// النتيجة: { totalErrors: 10, authErrors: 2, ... }
```

#### `getErrorType(error)`
تصنيف نوع الخطأ.

```javascript
const errorType = ErrorHandler.getErrorType(error);
// النتيجة: 'RATE_LIMIT', 'AUTH', 'DATABASE', etc.
```

## 🔧 أمثلة الاستخدام

### مثال 1: إنشاء Work Order آمن
```javascript
bot.action('wo_new', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user } = await SecurityManager.authenticateUser(ctx);
    
    // التحقق من حدود الخطة
    await PlanManager.checkPlanLimit(user.activeFacilityId, 'workOrders', 1);
    
    // إنشاء فلوه جديد
    FlowManager.setFlow(user.tgId.toString(), 'wo_new', 1, {});
    
    await ctx.reply('🔧 Work Order Creation (1/6)\nChoose the type of work:');
  }, ctx, 'create_work_order');
});
```

### مثال 2: معالجة النص مع التحقق
```javascript
bot.on('text', async (ctx, next) => {
  try {
    const { user } = await SecurityManager.authenticateUser(ctx);
    const flowState = FlowManager.getFlow(user.tgId.toString());
    
    if (!flowState) return next();
    
    // التحقق من ملكية الفلوه
    if (!FlowManager.validateFlowOwnership(user.tgId.toString(), flowState)) {
      FlowManager.clearFlow(user.tgId.toString());
      return ctx.reply('⚠️ Session expired. Please start over.');
    }
    
    // تنقية المدخلات
    const text = SecurityManager.sanitizeInput(ctx.message.text || '', 1000);
    
    // معالجة الفلوه
    if (flowState.flow === 'wo_new') {
      // معالجة Work Order flow
    }
  } catch (error) {
    ErrorHandler.handleError(error, ctx, 'text_handler');
  }
});
```

### مثال 3: التحقق من الصلاحيات
```javascript
bot.action('facility_dashboard', async (ctx) => {
  return ErrorHandler.safeExecute(async () => {
    const { user, facility, membership } = await SecurityManager.validateFacilityAccess(
      ctx, 
      null, 
      ['facility_admin', 'supervisor']
    );
    
    // عرض لوحة التحكم
    await showDashboard(ctx, facility, membership);
  }, ctx, 'facility_dashboard');
});
```

## 🧪 الاختبارات

### تشغيل اختبارات الوحدات
```bash
node api/telegram/test-modules.js
```

### اختبار SecurityManager
```javascript
// اختبار تنقية المدخلات
const sanitized = SecurityManager.sanitizeInput('<script>alert("xss")</script>Hello');
console.log(sanitized); // 'alert("xss")Hello'

// اختبار التحقق من البريد الإلكتروني
const email = SecurityManager.validateEmail('test@example.com');
console.log(email); // 'test@example.com'
```

### اختبار FlowManager
```javascript
// إنشاء فلوه
FlowManager.setFlow('123', 'test', 1, { data: 'value' });

// التحقق من الفلوه
const flow = FlowManager.getFlow('123');
console.log(flow); // { flow: 'test', step: 1, data: { data: 'value' }, ... }
```

### اختبار PlanManager
```javascript
// الحصول على الخطط المتاحة
const plans = PlanManager.getAvailablePlans();
console.log(plans); // ['Free', 'Pro', 'Business']

// مقارنة الخطط
const comparison = PlanManager.getPlanComparison('Free', 'Pro');
console.log(comparison); // { improvements: { members: 15, workOrders: 150, ... } }
```

## 📈 إحصائيات الوحدات

### SecurityManager
- **الدوال**: 8 دوال رئيسية
- **الأسطر**: 247 سطر
- **الوظائف**: الأمان، التحقق، تنقية المدخلات

### FlowManager
- **الدوال**: 10 دوال رئيسية
- **الأسطر**: 169 سطر
- **الوظائف**: إدارة الفلوهات، انتهاء الصلاحية

### PlanManager
- **الدوال**: 8 دوال رئيسية
- **الأسطر**: 316 سطر
- **الوظائف**: إدارة الخطط، التحقق من الحدود

### ErrorHandler
- **الدوال**: 10 دوال رئيسية
- **الأسطر**: 283 سطر
- **الوظائف**: معالجة الأخطاء، التسجيل، التصنيف

## 🚀 التطوير المستقبلي

### الوحدات المخططة
1. **NotificationManager** - إدارة الإشعارات
2. **ReportManager** - إدارة التقارير
3. **MasterManager** - إدارة صلاحيات الماستر
4. **CacheManager** - إدارة التخزين المؤقت

### التحسينات المخططة
1. **TypeScript** - إضافة أنواع البيانات
2. **Unit Tests** - اختبارات شاملة لكل وحدة
3. **Performance Monitoring** - مراقبة الأداء
4. **Logging System** - نظام تسجيل متقدم

---

*تم تطوير هذه الوحدات لضمان قابلية الصيانة والتطوير المستمر* 🚀
