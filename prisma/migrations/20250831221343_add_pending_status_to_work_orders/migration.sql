-- AlterEnum
ALTER TYPE "WorkOrderStatus" ADD VALUE 'pending';

-- AlterTable
ALTER TABLE "WorkOrder" ALTER COLUMN "status" SET DEFAULT 'pending';
