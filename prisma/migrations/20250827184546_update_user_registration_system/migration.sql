/*
  Warnings:

  - You are about to drop the column `createdAt` on the `FacilitySwitchRequest` table. All the data in the column will be lost.
  - You are about to drop the column `fromFacilityId` on the `FacilitySwitchRequest` table. All the data in the column will be lost.
  - You are about to drop the column `toFacilityId` on the `FacilitySwitchRequest` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `FacilitySwitchRequest` table. All the data in the column will be lost.
  - You are about to drop the column `requestedRole` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `username` on the `User` table. All the data in the column will be lost.
  - Added the required column `facilityId` to the `FacilitySwitchRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'new_member_request';
ALTER TYPE "NotificationType" ADD VALUE 'membership_approved';
ALTER TYPE "NotificationType" ADD VALUE 'role_changed';

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "FacilityMember" ADD COLUMN     "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "FacilitySwitchRequest" DROP COLUMN "createdAt",
DROP COLUMN "fromFacilityId",
DROP COLUMN "toFacilityId",
DROP COLUMN "updatedAt",
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" BIGINT,
ADD COLUMN     "facilityId" BIGINT NOT NULL,
ADD COLUMN     "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "requestedRole" "Role" NOT NULL DEFAULT 'user';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "requestedRole",
DROP COLUMN "username",
ADD COLUMN     "email" TEXT;

-- AddForeignKey
ALTER TABLE "FacilitySwitchRequest" ADD CONSTRAINT "FacilitySwitchRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
