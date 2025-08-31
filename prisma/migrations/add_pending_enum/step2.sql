-- Step 2: Update default value to pending
ALTER TABLE "WorkOrder" ALTER COLUMN "status" SET DEFAULT 'pending'::"WorkOrderStatus";
