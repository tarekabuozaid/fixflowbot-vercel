/*
  Warnings:

  - You are about to drop the column `date` on the `StatusHistory` table. All the data in the column will be lost.
  - You are about to drop the column `updatedBy` on the `StatusHistory` table. All the data in the column will be lost.
  - Added the required column `updatedByUserId` to the `StatusHistory` table without a default value. This is not possible if the table is not empty.
  - Made the column `oldStatus` on table `StatusHistory` required. This step will fail if there are existing NULL values in that column.
  - Made the column `newStatus` on table `StatusHistory` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "StatusHistory_workOrderId_date_idx";

-- AlterTable
ALTER TABLE "StatusHistory" DROP COLUMN "date",
DROP COLUMN "updatedBy",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedByUserId" BIGINT NOT NULL,
ALTER COLUMN "oldStatus" SET NOT NULL,
ALTER COLUMN "newStatus" SET NOT NULL;

-- CreateIndex
CREATE INDEX "StatusHistory_workOrderId_createdAt_idx" ON "StatusHistory"("workOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
