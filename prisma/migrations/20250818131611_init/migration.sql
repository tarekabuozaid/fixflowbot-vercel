-- CreateEnum
CREATE TYPE "Role" AS ENUM ('facility_admin', 'supervisor', 'technician', 'user');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'blocked');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('open', 'in_progress', 'done', 'closed');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('Free', 'Pro', 'Business');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGSERIAL NOT NULL,
    "tgId" BIGINT,
    "firstName" TEXT,
    "username" TEXT,
    "phone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'pending',
    "requestedRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activeFacilityId" BIGINT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
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

    CONSTRAINT "FacilityMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" BIGSERIAL NOT NULL,
    "facilityId" BIGINT NOT NULL,
    "createdByUserId" BIGINT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'open',
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
    "date" TIMESTAMP(3) NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "StatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilitySwitchRequest" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "fromFacilityId" BIGINT,
    "toFacilityId" BIGINT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilitySwitchRequest_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "StatusHistory_workOrderId_date_idx" ON "StatusHistory"("workOrderId", "date");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeFacilityId_fkey" FOREIGN KEY ("activeFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityMember" ADD CONSTRAINT "FacilityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityMember" ADD CONSTRAINT "FacilityMember_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySwitchRequest" ADD CONSTRAINT "FacilitySwitchRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
