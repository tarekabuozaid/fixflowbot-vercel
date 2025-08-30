/**
 * Facility Service - خدمة إدارة المنشآت
 * 
 * هذا الملف يحتوي على منطق إدارة المنشآت
 */

const { prisma, handleDatabaseError } = require('./_db');
const { 
  createValidationError, 
  createNotFoundError, 
  createConflictError 
} = require('./errors');
const PlanService = require('./planService');

class FacilityService {
  
  /**
   * إنشاء منشأة جديدة
   */
  static async createFacility(facilityData, adminUserId) {
    try {
      // التحقق من البيانات المطلوبة
      if (!facilityData.name) {
        throw createValidationError('name', 'Facility name is required');
      }

      if (!facilityData.planTier) {
        throw createValidationError('planTier', 'Plan tier is required');
      }

      // التحقق من عدم وجود منشأة بنفس الاسم
      const existingFacility = await prisma.facility.findFirst({
        where: { name: facilityData.name }
      });

      if (existingFacility) {
        throw createConflictError('A facility with this name already exists');
      }

      // إنشاء المنشأة
      const facility = await prisma.facility.create({
        data: {
          name: facilityData.name,
          city: facilityData.city,
          phone: facilityData.phone,
          planTier: facilityData.planTier,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      // إنشاء عضوية للمدير
      if (adminUserId) {
        await prisma.facilityMember.create({
          data: {
            userId: BigInt(adminUserId),
            facilityId: facility.id,
            role: 'facility_admin',
            status: 'active',
            joinedAt: new Date()
          }
        });

        // تحديث المنشأة النشطة للمدير
        await prisma.user.update({
          where: { id: BigInt(adminUserId) },
          data: { activeFacilityId: facility.id }
        });
      }

      return {
        success: true,
        facility
      };
    } catch (error) {
      return handleDatabaseError(error, 'createFacility');
    }
  }

  /**
   * الحصول على منشأة بواسطة ID
   */
  static async getFacilityById(facilityId) {
    try {
      const facility = await prisma.facility.findUnique({
        where: { id: BigInt(facilityId) },
        include: {
          members: {
            include: {
              user: true
            }
          },
          workOrders: {
            take: 10,
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!facility) {
        throw createNotFoundError('Facility');
      }

      return {
        success: true,
        facility
      };
    } catch (error) {
      return handleDatabaseError(error, 'getFacilityById');
    }
  }

  /**
   * الحصول على جميع المنشآت النشطة
   */
  static async getActiveFacilities(options = {}) {
    try {
      const { limit = 50, offset = 0, city } = options;

      const where = {
        status: 'active'
      };

      if (city) {
        where.city = city;
      }

      const facilities = await prisma.facility.findMany({
        where,
        include: {
          _count: {
            select: {
              members: true,
              workOrders: true
            }
          }
        },
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset
      });

      const total = await prisma.facility.count({ where });

      return {
        success: true,
        facilities,
        total,
        hasMore: offset + limit < total
      };
    } catch (error) {
      return handleDatabaseError(error, 'getActiveFacilities');
    }
  }

  /**
   * تحديث بيانات المنشأة
   */
  static async updateFacility(facilityId, updateData) {
    try {
      // التحقق من وجود المنشأة
      const existingFacility = await prisma.facility.findUnique({
        where: { id: BigInt(facilityId) }
      });

      if (!existingFacility) {
        throw createNotFoundError('Facility');
      }

      // التحقق من عدم وجود منشأة أخرى بنفس الاسم
      if (updateData.name && updateData.name !== existingFacility.name) {
        const duplicateFacility = await prisma.facility.findFirst({
          where: { 
            name: updateData.name,
            id: { not: BigInt(facilityId) }
          }
        });

        if (duplicateFacility) {
          throw createConflictError('A facility with this name already exists');
        }
      }

      // تحديث المنشأة
      const facility = await prisma.facility.update({
        where: { id: BigInt(facilityId) },
        data: {
          ...updateData,
          updatedAt: new Date()
        }
      });

      return {
        success: true,
        facility
      };
    } catch (error) {
      return handleDatabaseError(error, 'updateFacility');
    }
  }

  /**
   * حذف منشأة
   */
  static async deleteFacility(facilityId) {
    try {
      // التحقق من وجود المنشأة
      const facility = await prisma.facility.findUnique({
        where: { id: BigInt(facilityId) },
        include: {
          _count: {
            select: {
              members: true,
              workOrders: true
            }
          }
        }
      });

      if (!facility) {
        throw createNotFoundError('Facility');
      }

      // التحقق من عدم وجود أعضاء أو بلاغات
      if (facility._count.members > 0 || facility._count.workOrders > 0) {
        throw createConflictError('Cannot delete facility with active members or work orders');
      }

      // حذف المنشأة
      await prisma.facility.delete({
        where: { id: BigInt(facilityId) }
      });

      return {
        success: true,
        message: 'Facility deleted successfully'
      };
    } catch (error) {
      return handleDatabaseError(error, 'deleteFacility');
    }
  }

  /**
   * الحصول على إحصائيات المنشأة
   */
  static async getFacilityStats(facilityId) {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        totalWorkOrders,
        openWorkOrders,
        inProgressWorkOrders,
        completedWorkOrders,
        closedWorkOrders,
        todayWorkOrders,
        weeklyWorkOrders,
        monthlyWorkOrders,
        totalMembers,
        activeMembers,
        facilityAdmins,
        supervisors,
        technicians,
        users,
        planInfo
      ] = await Promise.all([
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId) } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), status: 'open' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), status: 'in_progress' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), status: 'done' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), status: 'closed' } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), createdAt: { gte: today } } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), createdAt: { gte: weekAgo } } }),
        prisma.workOrder.count({ where: { facilityId: BigInt(facilityId), createdAt: { gte: monthAgo } } }),
        prisma.facilityMember.count({ where: { facilityId: BigInt(facilityId) } }),
        prisma.facilityMember.count({ where: { facilityId: BigInt(facilityId), status: 'active' } }),
        prisma.facilityMember.count({ where: { facilityId: BigInt(facilityId), role: 'facility_admin', status: 'active' } }),
        prisma.facilityMember.count({ where: { facilityId: BigInt(facilityId), role: 'supervisor', status: 'active' } }),
        prisma.facilityMember.count({ where: { facilityId: BigInt(facilityId), role: 'technician', status: 'active' } }),
        prisma.facilityMember.count({ where: { facilityId: BigInt(facilityId), role: 'user', status: 'active' } }),
        PlanService.getPlanInfo(facilityId.toString())
      ]);

      return {
        success: true,
        stats: {
          workOrders: {
            total: totalWorkOrders,
            open: openWorkOrders,
            inProgress: inProgressWorkOrders,
            completed: completedWorkOrders,
            closed: closedWorkOrders,
            today: todayWorkOrders,
            weekly: weeklyWorkOrders,
            monthly: monthlyWorkOrders
          },
          members: {
            total: totalMembers,
            active: activeMembers,
            facilityAdmins,
            supervisors,
            technicians,
            users
          },
          plan: planInfo.success ? planInfo : null
        }
      };
    } catch (error) {
      return handleDatabaseError(error, 'getFacilityStats');
    }
  }

  /**
   * البحث عن منشآت
   */
  static async searchFacilities(query, options = {}) {
    try {
      const { limit = 20, offset = 0 } = options;

      const facilities = await prisma.facility.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { city: { contains: query, mode: 'insensitive' } }
          ],
          status: 'active'
        },
        include: {
          _count: {
            select: {
              members: true,
              workOrders: true
            }
          }
        },
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset
      });

      const total = await prisma.facility.count({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { city: { contains: query, mode: 'insensitive' } }
          ],
          status: 'active'
        }
      });

      return {
        success: true,
        facilities,
        total,
        hasMore: offset + limit < total
      };
    } catch (error) {
      return handleDatabaseError(error, 'searchFacilities');
    }
  }

  /**
   * الحصول على منشآت المستخدم
   */
  static async getUserFacilities(userId) {
    try {
      const memberships = await prisma.facilityMember.findMany({
        where: {
          userId: BigInt(userId),
          status: 'active'
        },
        include: {
          facility: {
            include: {
              _count: {
                select: {
                  members: true,
                  workOrders: true
                }
              }
            }
          }
        },
        orderBy: {
          facility: { name: 'asc' }
        }
      });

      return {
        success: true,
        facilities: memberships.map(membership => ({
          ...membership.facility,
          userRole: membership.role,
          joinedAt: membership.joinedAt
        }))
      };
    } catch (error) {
      return handleDatabaseError(error, 'getUserFacilities');
    }
  }
}

module.exports = FacilityService;
