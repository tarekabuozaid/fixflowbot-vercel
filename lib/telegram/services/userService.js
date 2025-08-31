/**
 * User Service - خدمة إدارة المستخدمين
 * 
 * هذا الملف يحتوي على منطق إدارة المستخدمين
 */

const { prisma, handleDatabaseError } = require('./_db');
const { 
  createValidationError, 
  createNotFoundError, 
  createConflictError,
  ValidationError 
} = require('./errors');

class UserService {
  
  /**
   * إنشاء أو تحديث مستخدم
   */
  static async createOrUpdateUser(userData) {
    try {
      // التحقق من البيانات المطلوبة
      if (!userData.tgId) {
        throw createValidationError('tgId', 'Telegram ID is required');
      }

      // البحث عن المستخدم الموجود
      let user = await prisma.user.findUnique({
        where: { tgId: userData.tgId }
      });

      if (user) {
        // تحديث المستخدم الموجود
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            firstName: userData.firstName || user.firstName,
            lastName: userData.lastName || user.lastName,
            username: userData.username || user.username,
            email: userData.email || user.email,
            phone: userData.phone || user.phone,
            jobTitle: userData.jobTitle || user.jobTitle,
            status: userData.status || user.status,
            updatedAt: new Date()
          }
        });
      } else {
        // إنشاء مستخدم جديد
        user = await prisma.user.create({
          data: {
            tgId: userData.tgId,
            firstName: userData.firstName,
            lastName: userData.lastName,
            username: userData.username,
            email: userData.email,
            phone: userData.phone,
            jobTitle: userData.jobTitle,
            status: userData.status || 'active',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
      }

      return {
        success: true,
        user,
        isNew: !user.createdAt || user.createdAt === user.updatedAt
      };
    } catch (error) {
      return handleDatabaseError(error, 'createOrUpdateUser');
    }
  }

  /**
   * الحصول على مستخدم بواسطة Telegram ID
   */
  static async getUserByTgId(tgId) {
    try {
      const user = await prisma.user.findUnique({
        where: { tgId },
        include: {
          activeFacility: true,
          memberships: {
            include: {
              facility: true
            }
          }
        }
      });

      if (!user) {
        throw createNotFoundError('User');
      }

      return {
        success: true,
        user
      };
    } catch (error) {
      return handleDatabaseError(error, 'getUserByTgId');
    }
  }

  /**
   * الحصول على مستخدم بواسطة ID
   */
  static async getUserById(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: BigInt(userId) },
        include: {
          activeFacility: true,
          memberships: {
            include: {
              facility: true
            }
          }
        }
      });

      if (!user) {
        throw createNotFoundError('User');
      }

      return {
        success: true,
        user
      };
    } catch (error) {
      return handleDatabaseError(error, 'getUserById');
    }
  }

  /**
   * تحديث بيانات المستخدم
   */
  static async updateUser(userId, updateData) {
    try {
      // التحقق من وجود المستخدم
      const existingUser = await prisma.user.findUnique({
        where: { id: BigInt(userId) }
      });

      if (!existingUser) {
        throw createNotFoundError('User');
      }

      // التحقق من صحة البيانات
      if (updateData.email && !this.validateEmail(updateData.email)) {
        throw createValidationError('email', 'Invalid email format');
      }

      if (updateData.phone && !this.validatePhone(updateData.phone)) {
        throw createValidationError('phone', 'Invalid phone format');
      }

      // تحديث المستخدم
      const user = await prisma.user.update({
        where: { id: BigInt(userId) },
        data: {
          ...updateData,
          updatedAt: new Date()
        }
      });

      return {
        success: true,
        user
      };
    } catch (error) {
      return handleDatabaseError(error, 'updateUser');
    }
  }

  /**
   * إنشاء عضوية في منشأة
   */
  static async createFacilityMembership(userId, facilityId, role = 'user') {
    try {
      // التحقق من وجود المستخدم والمنشأة
      const [user, facility] = await Promise.all([
        prisma.user.findUnique({ where: { id: BigInt(userId) } }),
        prisma.facility.findUnique({ where: { id: BigInt(facilityId) } })
      ]);

      if (!user) {
        throw createNotFoundError('User');
      }

      if (!facility) {
        throw createNotFoundError('Facility');
      }

      // التحقق من عدم وجود عضوية مسبقة
      const existingMembership = await prisma.facilityMember.findFirst({
        where: {
          userId: BigInt(userId),
          facilityId: BigInt(facilityId)
        }
      });

      if (existingMembership) {
        throw createConflictError('User is already a member of this facility');
      }

      // إنشاء العضوية
      const membership = await prisma.facilityMember.create({
        data: {
          userId: BigInt(userId),
          facilityId: BigInt(facilityId),
          role,
          status: 'active',
          joinedAt: new Date()
        },
        include: {
          user: true,
          facility: true
        }
      });

      return {
        success: true,
        membership
      };
    } catch (error) {
      return handleDatabaseError(error, 'createFacilityMembership');
    }
  }

  /**
   * تحديث دور العضو
   */
  static async updateMemberRole(membershipId, newRole) {
    try {
      const validRoles = ['user', 'technician', 'supervisor', 'facility_admin'];
      if (!validRoles.includes(newRole)) {
        throw createValidationError('role', 'Invalid role');
      }

      const membership = await prisma.facilityMember.update({
        where: { id: BigInt(membershipId) },
        data: { role: newRole },
        include: {
          user: true,
          facility: true
        }
      });

      return {
        success: true,
        membership
      };
    } catch (error) {
      return handleDatabaseError(error, 'updateMemberRole');
    }
  }

  /**
   * إزالة عضو من منشأة
   */
  static async removeFacilityMember(membershipId) {
    try {
      const membership = await prisma.facilityMember.findUnique({
        where: { id: BigInt(membershipId) },
        include: {
          user: true,
          facility: true
        }
      });

      if (!membership) {
        throw createNotFoundError('Facility membership');
      }

      // حذف العضوية
      await prisma.facilityMember.delete({
        where: { id: BigInt(membershipId) }
      });

      // إذا كان هذا هو المنشأة النشطة للمستخدم، إزالة المنشأة النشطة
      if (membership.user.activeFacilityId === membership.facilityId) {
        await prisma.user.update({
          where: { id: membership.userId },
          data: { activeFacilityId: null }
        });
      }

      return {
        success: true,
        message: 'Member removed successfully'
      };
    } catch (error) {
      return handleDatabaseError(error, 'removeFacilityMember');
    }
  }

  /**
   * تبديل المنشأة النشطة
   */
  static async switchActiveFacility(userId, facilityId) {
    try {
      // التحقق من وجود العضوية
      const membership = await prisma.facilityMember.findFirst({
        where: {
          userId: BigInt(userId),
          facilityId: BigInt(facilityId),
          status: 'active'
        }
      });

      if (!membership) {
        throw createNotFoundError('Active facility membership');
      }

      // تحديث المنشأة النشطة
      const user = await prisma.user.update({
        where: { id: BigInt(userId) },
        data: { activeFacilityId: BigInt(facilityId) }
      });

      return {
        success: true,
        user,
        membership
      };
    } catch (error) {
      return handleDatabaseError(error, 'switchActiveFacility');
    }
  }

  /**
   * الحصول على أعضاء منشأة
   */
  static async getFacilityMembers(facilityId, options = {}) {
    try {
      const { role, status = 'active', limit = 50, offset = 0 } = options;

      const where = {
        facilityId: BigInt(facilityId)
      };

      if (role) {
        where.role = role;
      }

      if (status) {
        where.status = status;
      }

      const members = await prisma.facilityMember.findMany({
        where,
        include: {
          user: true
        },
        orderBy: [
          { role: 'asc' },
          { user: { firstName: 'asc' } }
        ],
        take: limit,
        skip: offset
      });

      const total = await prisma.facilityMember.count({ where });

      return {
        success: true,
        members,
        total,
        hasMore: offset + limit < total
      };
    } catch (error) {
      return handleDatabaseError(error, 'getFacilityMembers');
    }
  }

  /**
   * التحقق من صحة البريد الإلكتروني
   */
  static validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * التحقق من صحة رقم الهاتف
   */
  static validatePhone(phone) {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone);
  }

  /**
   * التحقق من صحة الاسم
   */
  static validateName(name) {
    return name && name.length >= 2 && name.length <= 50;
  }
}

module.exports = UserService;
