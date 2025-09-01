-- CreateEnum
CREATE TYPE "Role" AS ENUM ('facility_admin', 'supervisor', 'technician', 'user');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'blocked');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('open', 'in_progress', 'done', 'closed', 'pending');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('Free', 'Pro', 'Business');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('work_order_created', 'work_order_status_changed', 'work_order_assigned', 'member_joined', 'member_left', 'facility_activated', 'high_priority_alert', 'daily_summary', 'weekly_report', 'system_alert', 'new_member_request', 'membership_approved', 'role_changed');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('work_order_summary', 'member_activity', 'facility_performance', 'priority_analysis', 'status_distribution');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('work_order_due', 'work_order_overdue', 'periodic_check', 'custom_reminder', 'maintenance_schedule', 'inspection_due');

-- CreateEnum
CREATE TYPE "ReminderFrequency" AS ENUM ('once', 'daily', 'weekly', 'monthly', 'custom');

-- CreateEnum
CREATE TYPE "ChatType" AS ENUM ('team', 'project', 'support', 'emergency', 'private');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('admin', 'moderator', 'member');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'image', 'voice', 'video', 'file', 'location', 'contact');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGSERIAL NOT NULL,
    "tgId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activeFacilityId" BIGINT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "phone" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "planTier" "PlanTier" NOT NULL DEFAULT 'Free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityMember" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "facilityId" BIGINT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" BIGSERIAL NOT NULL,
    "facilityId" BIGINT NOT NULL,
    "createdByUserId" BIGINT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'pending',
    "typeOfWork" TEXT,
    "typeOfService" TEXT,
    "priority" TEXT,
    "location" TEXT,
    "department" TEXT,
    "equipment" TEXT,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "callerPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageUrl" TEXT,
    "closeImageUrl" TEXT,
    "maintenanceType" TEXT,
    "groupName" TEXT,
    "assignee" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusHistory" (
    "id" BIGSERIAL NOT NULL,
    "workOrderId" BIGINT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" BIGINT NOT NULL,

    CONSTRAINT "StatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilitySwitchRequest" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "facilityId" BIGINT NOT NULL,
    "requestedRole" "Role" NOT NULL DEFAULT 'user',
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" BIGINT,

    CONSTRAINT "FacilitySwitchRequest_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ChatRoom" (
    "id" BIGSERIAL NOT NULL,
    "facilityId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ChatType" NOT NULL DEFAULT 'team',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" BIGINT NOT NULL,

    CONSTRAINT "ChatRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "id" BIGSERIAL NOT NULL,
    "chatRoomId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "role" "ChatRole" NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" BIGSERIAL NOT NULL,
    "chatRoomId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "messageType" "MessageType" NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "replyToId" BIGINT,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tgId_key" ON "User"("tgId");

-- CreateIndex
CREATE INDEX "User_activeFacilityId_idx" ON "User"("activeFacilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_name_key" ON "Facility"("name");

-- CreateIndex
CREATE INDEX "FacilityMember_facilityId_role_idx" ON "FacilityMember"("facilityId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityMember_userId_facilityId_key" ON "FacilityMember"("userId", "facilityId");

-- CreateIndex
CREATE INDEX "WorkOrder_facilityId_status_updatedAt_idx" ON "WorkOrder"("facilityId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkOrder_createdByUserId_idx" ON "WorkOrder"("createdByUserId");

-- CreateIndex
CREATE INDEX "StatusHistory_workOrderId_createdAt_idx" ON "StatusHistory"("workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_facilityId_type_createdAt_idx" ON "Notification"("facilityId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Report_facilityId_type_period_createdAt_idx" ON "Report"("facilityId", "type", "period", "createdAt");

-- CreateIndex
CREATE INDEX "Reminder_facilityId_scheduledFor_isActive_idx" ON "Reminder"("facilityId", "scheduledFor", "isActive");

-- CreateIndex
CREATE INDEX "Reminder_createdByUserId_scheduledFor_idx" ON "Reminder"("createdByUserId", "scheduledFor");

-- CreateIndex
CREATE INDEX "ChatRoom_facilityId_type_isActive_idx" ON "ChatRoom"("facilityId", "type", "isActive");

-- CreateIndex
CREATE INDEX "ChatMember_chatRoomId_isActive_idx" ON "ChatMember"("chatRoomId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMember_chatRoomId_userId_key" ON "ChatMember"("chatRoomId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_chatRoomId_createdAt_idx" ON "ChatMessage"("chatRoomId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_createdAt_idx" ON "ChatMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeFacilityId_fkey" FOREIGN KEY ("activeFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityMember" ADD CONSTRAINT "FacilityMember_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityMember" ADD CONSTRAINT "FacilityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySwitchRequest" ADD CONSTRAINT "FacilitySwitchRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySwitchRequest" ADD CONSTRAINT "FacilitySwitchRequest_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
