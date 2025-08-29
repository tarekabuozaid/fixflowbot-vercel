/**
 * User Controller - إدارة عمليات المستخدمين
 * 
 * هذا الملف يحتوي على جميع العمليات المتعلقة بالمستخدمين:
 * - تسجيل المستخدمين الجدد
 * - إدارة الملف الشخصي
 * - إدارة العضوية في المنشآت
 * - إدارة الأدوار والصلاحيات
 */

const { Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');

// Import utilities
const SecurityManager = require('../utils/security');
const FlowManager = require('../utils/flowManager');
const PlanManager = require('../utils/planManager');
const ErrorHandler = require('../utils/errorHandler');

const prisma = new PrismaClient();

class UserController {
  
  /**
   * عرض القائمة الرئيسية للمستخدم
   */
  static async showMainMenu(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Create Work Order', 'wo_new')],
        [Markup.button.callback('📋 My Work Orders', 'wo_list')],
        [Markup.button.callback('🏢 Facility Dashboard', 'facility_dashboard')],
        [Markup.button.callback('👥 Manage Members', 'manage_members')],
        [Markup.button.callback('📊 Reports', 'reports_menu')],
        [Markup.button.callback('🔔 Notifications', 'notifications')],
        [Markup.button.callback('⏰ Reminders', 'reminders')],
        [Markup.button.callback('❓ Help', 'help')]
      ]);

      const welcomeMessage = `🎉 Welcome back, ${user.firstName || 'User'}!

🏢 Active Facility: ${user.activeFacilityId ? 'Connected' : 'Not connected'}
👤 Role: ${user.jobTitle || 'User'}
📅 Member since: ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}

What would you like to do today?`;

      await ctx.reply(welcomeMessage, keyboard);
    }, ctx, 'show_main_menu');
  }

  /**
   * بدء تسجيل مستخدم جديد
   */
  static async startUserRegistration(ctx, role = 'user') {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      // التحقق من عدم وجود فلوه نشط
      if (FlowManager.hasActiveFlow(user.tgId.toString())) {
        FlowManager.clearFlow(user.tgId.toString());
      }

      // إنشاء فلوه تسجيل جديد
      FlowManager.setFlow(user.tgId.toString(), 'user_registration', 1, {
        role: role,
        userId: user.tgId.toString()
      });

      const roleNames = {
        'user': '👤 User',
        'technician': '🔧 Technician', 
        'supervisor': '👨‍💼 Supervisor'
      };

      const roleName = roleNames[role] || '👤 User';

      await ctx.reply(
        `📝 ${roleName} Registration (1/5)\n\n` +
        `Please enter your full name (first and last name):\n\n` +
        `Example: John Doe`,
        Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel Registration', 'user_reg_cancel')]
        ])
      );
    }, ctx, 'start_user_registration');
  }

  /**
   * معالجة خطوة تسجيل المستخدم
   */
  static async handleUserRegistrationStep(ctx, step, input) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      const flowState = FlowManager.getFlow(user.tgId.toString());
      
      if (!flowState || flowState.flow !== 'user_registration') {
        return ctx.reply('❌ No active registration found. Please start over.');
      }

      const sanitizedInput = SecurityManager.sanitizeInput(input, 100);

      switch (step) {
        case 1: // الاسم الكامل
          if (!SecurityManager.validateName(sanitizedInput)) {
            return ctx.reply('❌ Invalid name format. Please enter a valid name (2-50 characters).');
          }
          
          FlowManager.updateData(user.tgId.toString(), { fullName: sanitizedInput });
          FlowManager.updateStep(user.tgId.toString(), 2);
          
          await ctx.reply(
            '📝 User Registration (2/5)\n\n' +
            'Please enter your email address (optional):\n\n' +
            'Example: john.doe@company.com\n' +
            'Or type "skip" to skip this step.',
            Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel Registration', 'user_reg_cancel')]
            ])
          );
          break;

        case 2: // البريد الإلكتروني
          if (sanitizedInput.toLowerCase() === 'skip') {
            FlowManager.updateData(user.tgId.toString(), { email: null });
          } else if (sanitizedInput && !SecurityManager.validateEmail(sanitizedInput)) {
            return ctx.reply('❌ Invalid email format. Please enter a valid email or type "skip".');
          } else {
            FlowManager.updateData(user.tgId.toString(), { email: sanitizedInput || null });
          }
          
          FlowManager.updateStep(user.tgId.toString(), 3);
          
          await ctx.reply(
            '📝 User Registration (3/5)\n\n' +
            'Please enter your phone number (optional):\n\n' +
            'Example: +1234567890\n' +
            'Or type "skip" to skip this step.',
            Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel Registration', 'user_reg_cancel')]
            ])
          );
          break;

        case 3: // رقم الهاتف
          if (sanitizedInput.toLowerCase() === 'skip') {
            FlowManager.updateData(user.tgId.toString(), { phone: null });
          } else if (sanitizedInput && !SecurityManager.validatePhone(sanitizedInput)) {
            return ctx.reply('❌ Invalid phone format. Please enter a valid phone or type "skip".');
          } else {
            FlowManager.updateData(user.tgId.toString(), { phone: sanitizedInput || null });
          }
          
          FlowManager.updateStep(user.tgId.toString(), 4);
          
          await ctx.reply(
            '📝 User Registration (4/5)\n\n' +
            'Please enter your job title (optional):\n\n' +
            'Example: Senior Technician, Facility Manager\n' +
            'Or type "skip" to skip this step.',
            Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel Registration', 'user_reg_cancel')]
            ])
          );
          break;

        case 4: // المسمى الوظيفي
          if (sanitizedInput.toLowerCase() === 'skip') {
            FlowManager.updateData(user.tgId.toString(), { jobTitle: null });
          } else {
            FlowManager.updateData(user.tgId.toString(), { jobTitle: sanitizedInput });
          }
          
          FlowManager.updateStep(user.tgId.toString(), 5);
          
          // عرض المنشآت المتاحة
          const facilities = await prisma.facility.findMany({
            where: { status: 'active' },
            orderBy: { name: 'asc' }
          });

          if (facilities.length === 0) {
            return ctx.reply(
              '❌ No active facilities found.\n\n' +
              'Please contact the administrator to create a facility first.',
              Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
              ])
            );
          }

          const facilityButtons = facilities.map(facility => [
            Markup.button.callback(
              `${facility.name} (${facility.city || 'N/A'})`,
              `join_fac|${facility.id}`
            )
          ]);

          await ctx.reply(
            '📝 User Registration (5/5)\n\n' +
            'Please select a facility to join:\n\n' +
            'Choose the facility where you work:',
            Markup.inlineKeyboard([
              ...facilityButtons,
              [Markup.button.callback('❌ Cancel Registration', 'user_reg_cancel')]
            ])
          );
          break;

        default:
          return ctx.reply('❌ Invalid registration step.');
      }
    }, ctx, 'handle_user_registration_step');
  }

  /**
   * إلغاء تسجيل المستخدم
   */
  static async cancelUserRegistration(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      FlowManager.clearFlow(user.tgId.toString());
      
      await ctx.reply(
        '❌ User registration cancelled.\n\n' +
        'You can start registration again anytime.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
        ])
      );
    }, ctx, 'cancel_user_registration');
  }

  /**
   * إكمال تسجيل المستخدم
   */
  static async completeUserRegistration(ctx, facilityId) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      const flowState = FlowManager.getFlow(user.tgId.toString());
      
      if (!flowState || flowState.flow !== 'user_registration') {
        return ctx.reply('❌ No active registration found.');
      }

      // التحقق من وجود المنشأة
      const facility = await prisma.facility.findUnique({
        where: { id: BigInt(facilityId) }
      });

      if (!facility) {
        return ctx.reply('❌ Facility not found.');
      }

      // التحقق من حدود الخطة
      await PlanManager.checkPlanLimit(facilityId, 'members', 1);

      // تحديث بيانات المستخدم
      const [firstName, ...lastNameParts] = (flowState.data.fullName || '').split(' ');
      const lastName = lastNameParts.join(' ');

      await prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: firstName || null,
          lastName: lastName || null,
          email: flowState.data.email,
          phone: flowState.data.phone,
          jobTitle: flowState.data.jobTitle,
          status: 'active',
          activeFacilityId: BigInt(facilityId)
        }
      });

      // إنشاء عضوية في المنشأة
      const role = flowState.data.role === 'supervisor' ? 'supervisor' : 
                   flowState.data.role === 'technician' ? 'technician' : 'user';

      await prisma.facilityMember.create({
        data: {
          userId: user.id,
          facilityId: BigInt(facilityId),
          role: role,
          status: 'active'
        }
      });

      // مسح الفلوه
      FlowManager.clearFlow(user.tgId.toString());

      await ctx.reply(
        `✅ Registration completed successfully!\n\n` +
        `👤 Name: ${flowState.data.fullName}\n` +
        `🏢 Facility: ${facility.name}\n` +
        `🔧 Role: ${role.charAt(0).toUpperCase() + role.slice(1)}\n` +
        `📧 Email: ${flowState.data.email || 'Not provided'}\n` +
        `📱 Phone: ${flowState.data.phone || 'Not provided'}\n\n` +
        `Welcome to ${facility.name}!`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Go to Main Menu', 'back_to_menu')]
        ])
      );
    }, ctx, 'complete_user_registration');
  }

  /**
   * عرض معلومات المستخدم
   */
  static async showUserProfile(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      const activeFacility = user.activeFacilityId ? await prisma.facility.findUnique({
        where: { id: user.activeFacilityId }
      }) : null;

      const membership = user.activeFacilityId ? await prisma.facilityMember.findFirst({
        where: {
          userId: user.id,
          facilityId: user.activeFacilityId
        }
      }) : null;

      const profileMessage = `👤 **User Profile**

📝 **Personal Information:**
• Name: ${user.firstName || 'N/A'} ${user.lastName || ''}
• Email: ${user.email || 'Not provided'}
• Phone: ${user.phone || 'Not provided'}
• Job Title: ${user.jobTitle || 'Not specified'}

🏢 **Facility Information:**
• Active Facility: ${activeFacility ? activeFacility.name : 'Not connected'}
• Role: ${membership ? membership.role.charAt(0).toUpperCase() + membership.role.slice(1) : 'N/A'}
• Status: ${user.status}

📅 **Account Information:**
• Member since: ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
• Last updated: ${user.updatedAt ? new Date(user.updatedAt).toLocaleDateString() : 'N/A'}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Edit Profile', 'edit_profile')],
        [Markup.button.callback('🏢 Switch Facility', 'switch')],
        [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
      ]);

      await ctx.reply(profileMessage, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    }, ctx, 'show_user_profile');
  }

  /**
   * تبديل المنشأة النشطة
   */
  static async switchFacility(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      // البحث عن المنشآت التي ينتمي إليها المستخدم
      const memberships = await prisma.facilityMember.findMany({
        where: {
          userId: user.id,
          status: 'active'
        },
        include: {
          facility: true
        },
        orderBy: {
          facility: { name: 'asc' }
        }
      });

      if (memberships.length === 0) {
        return ctx.reply(
          '❌ You are not a member of any facility.\n\n' +
          'Please join a facility first.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        );
      }

      if (memberships.length === 1) {
        return ctx.reply(
          'ℹ️ You are only a member of one facility.\n\n' +
          `Current facility: ${memberships[0].facility.name}`,
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        );
      }

      const facilityButtons = memberships.map(membership => [
        Markup.button.callback(
          `${membership.facility.name} (${membership.role})`,
          `switch_to_${membership.facility.id}`
        )
      ]);

      await ctx.reply(
        '🏢 **Switch Active Facility**\n\n' +
        'Select a facility to switch to:\n\n' +
        'Current active facility will be changed.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            ...facilityButtons,
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        }
      );
    }, ctx, 'switch_facility');
  }

  /**
   * تنفيذ تبديل المنشأة
   */
  static async executeFacilitySwitch(ctx, facilityId) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      // التحقق من العضوية
      const membership = await prisma.facilityMember.findFirst({
        where: {
          userId: user.id,
          facilityId: BigInt(facilityId),
          status: 'active'
        },
        include: {
          facility: true
        }
      });

      if (!membership) {
        return ctx.reply('❌ You are not a member of this facility.');
      }

      // تحديث المنشأة النشطة
      await prisma.user.update({
        where: { id: user.id },
        data: { activeFacilityId: BigInt(facilityId) }
      });

      await ctx.reply(
        `✅ Successfully switched to ${membership.facility.name}!\n\n` +
        `🏢 Active Facility: ${membership.facility.name}\n` +
        `🔧 Your Role: ${membership.role.charAt(0).toUpperCase() + membership.role.slice(1)}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Go to Main Menu', 'back_to_menu')]
        ])
      );
    }, ctx, 'execute_facility_switch');
  }
}

module.exports = UserController;
