-- Add pending status to WorkOrderStatus enum
ALTER TYPE "WorkOrderStatus" ADD VALUE 'pending';

-- Update default value to pending
ALTER TABLE "WorkOrder" ALTER COLUMN "status" SET DEFAULT 'pending'::"WorkOrderStatus";
