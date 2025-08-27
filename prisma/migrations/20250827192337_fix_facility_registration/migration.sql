/*
  Warnings:

  - You are about to drop the column `isActive` on the `Facility` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Facility" DROP COLUMN "isActive",
ALTER COLUMN "status" SET DEFAULT 'pending';
