-- scripts/verify-import.sql
-- سكربت للتحقق من البيانات المستوردة من ملف الإكسيل

-- 1. إحصائيات عامة
SELECT 
  'Users' as table_name,
  COUNT(*) as total_rows
FROM "User"
UNION ALL
SELECT 
  'Facilities' as table_name,
  COUNT(*) as total_rows
FROM "Facility"
UNION ALL
SELECT 
  'FacilityMembers' as table_name,
  COUNT(*) as total_rows
FROM "FacilityMember"
UNION ALL
SELECT 
  'WorkOrders' as table_name,
  COUNT(*) as total_rows
FROM "WorkOrder"
UNION ALL
SELECT 
  'StatusHistory' as table_name,
  COUNT(*) as total_rows
FROM "StatusHistory";

-- 2. تفاصيل المستخدمين
SELECT 
  id,
  "tgId",
  "firstName",
  status,
  "requestedRole",
  "activeFacilityId",
  "createdAt"
FROM "User"
ORDER BY "createdAt" DESC
LIMIT 10;

-- 3. تفاصيل المنشآت
SELECT 
  id,
  name,
  "isDefault",
  "isActive",
  "planTier",
  "createdAt"
FROM "Facility"
ORDER BY "createdAt" DESC;

-- 4. العضويات
SELECT 
  fm.id,
  u."firstName" as user_name,
  u."tgId" as user_tg_id,
  f.name as facility_name,
  fm.role,
  fm."userId",
  fm."facilityId"
FROM "FacilityMember" fm
JOIN "User" u ON fm."userId" = u.id
JOIN "Facility" f ON fm."facilityId" = f.id
ORDER BY fm.id DESC
LIMIT 10;

-- 5. طلبات الصيانة
SELECT 
  wo.id,
  wo.status,
  wo.priority,
  wo.department,
  wo.description,
  f.name as facility_name,
  u."firstName" as created_by,
  wo."createdAt"
FROM "WorkOrder" wo
JOIN "Facility" f ON wo."facilityId" = f.id
LEFT JOIN "User" u ON wo."createdByUserId" = u.id
ORDER BY wo."createdAt" DESC
LIMIT 10;

-- 6. سجل التغييرات
SELECT 
  sh.id,
  sh."workOrderId",
  sh."oldStatus",
  sh."newStatus",
  u."firstName" as updated_by,
  sh."createdAt"
FROM "StatusHistory" sh
LEFT JOIN "User" u ON sh."updatedByUserId" = u.id
ORDER BY sh."createdAt" DESC
LIMIT 10;

-- 7. إحصائيات الحالات
SELECT 
  status,
  COUNT(*) as count
FROM "WorkOrder"
GROUP BY status
ORDER BY count DESC;

-- 8. إحصائيات الأولويات
SELECT 
  priority,
  COUNT(*) as count
FROM "WorkOrder"
WHERE priority IS NOT NULL
GROUP BY priority
ORDER BY count DESC;

-- 9. إحصائيات الأقسام
SELECT 
  department,
  COUNT(*) as count
FROM "WorkOrder"
WHERE department IS NOT NULL
GROUP BY department
ORDER BY count DESC;
