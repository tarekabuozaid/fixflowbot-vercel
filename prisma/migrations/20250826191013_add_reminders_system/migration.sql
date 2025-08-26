-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('work_order_due', 'work_order_overdue', 'periodic_check', 'custom_reminder', 'maintenance_schedule', 'inspection_due');

-- CreateEnum
CREATE TYPE "ReminderFrequency" AS ENUM ('once', 'daily', 'weekly', 'monthly', 'custom');

-- CreateTable
CREATE TABLE "Reminder" (
    "id" BIGSERIAL NOT NULL,
    "facilityId" BIGINT NOT NULL,
    "createdByUserId" BIGINT NOT NULL,
    "type" "ReminderType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "frequency" "ReminderFrequency" NOT NULL DEFAULT 'once',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "lastSent" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_facilityId_scheduledFor_isActive_idx" ON "Reminder"("facilityId", "scheduledFor", "isActive");

-- CreateIndex
CREATE INDEX "Reminder_createdByUserId_scheduledFor_idx" ON "Reminder"("createdByUserId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
