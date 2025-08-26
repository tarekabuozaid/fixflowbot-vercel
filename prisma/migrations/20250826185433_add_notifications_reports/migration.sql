-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('work_order_created', 'work_order_status_changed', 'work_order_assigned', 'member_joined', 'member_left', 'facility_activated', 'high_priority_alert', 'daily_summary', 'weekly_report', 'system_alert');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('work_order_summary', 'member_activity', 'facility_performance', 'priority_analysis', 'status_distribution');

-- CreateTable
CREATE TABLE "Notification" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "facilityId" BIGINT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" BIGSERIAL NOT NULL,
    "facilityId" BIGINT NOT NULL,
    "type" "ReportType" NOT NULL,
    "period" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_facilityId_type_createdAt_idx" ON "Notification"("facilityId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Report_facilityId_type_period_createdAt_idx" ON "Report"("facilityId", "type", "period", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
