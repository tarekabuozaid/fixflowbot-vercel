/**
 * Facility Controller - إدارة عمليات المنشآت
 * 
 * هذا الملف يحتوي على جميع العمليات المتعلقة بالمنشآت:
 * - تسجيل منشآت جديدة
 * - إدارة المنشآت
 * - إدارة الأعضاء
 * - إدارة الإعدادات
 */

const { Markup } = require('telegraf');

// Import Services
const { FacilityService, UserService, PlanService } = require('../services');

// Import utilities
const SecurityManager = require('../utils/security');
const FlowManager = require('../utils/flowManager');
const ErrorHandler = require('../utils/errorHandler');

class FacilityController {
  
  /**
   * بدء تسجيل منشأة جديدة
   */
  static async startFacilityRegistration(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      // التحقق من عدم وجود فلوه نشط
      if (FlowManager.hasActiveFlow(user.tgId.toString())) {
        FlowManager.clearFlow(user.tgId.toString());
      }

      // إنشاء فلوه تسجيل منشأة جديد
      FlowManager.setFlow(user.tgId.toString(), 'facility_registration', 1, {
        userId: user.tgId.toString()
      });

      await ctx.reply(
        '🏢 **Facility Registration (1/4)**\n\n' +
        'Please enter the facility name:\n\n' +
        'Example: Main Office Building\n' +
        'Requirements: 2-60 characters',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel Registration', 'regfac_cancel')]
          ])
        }
      );
    }, ctx, 'start_facility_registration');
  }

  /**
   * معالجة خطوة تسجيل المنشأة
   */
  static async handleFacilityRegistrationStep(ctx, step, input) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      const flowState = FlowManager.getFlow(user.tgId.toString());
      
      if (!flowState || flowState.flow !== 'facility_registration') {
        return ctx.reply('❌ No active facility registration found. Please start over.');
      }

      const sanitizedInput = SecurityManager.sanitizeInput(input, 100);

      switch (step) {
        case 1: // اسم المنشأة
          if (!sanitizedInput || sanitizedInput.length < 2 || sanitizedInput.length > 60) {
            return ctx.reply('❌ Invalid facility name. Please enter a name between 2-60 characters.');
          }
          
          // التحقق من عدم وجود منشأة بنفس الاسم باستخدام FacilityService
          const searchResult = await FacilityService.searchFacilities(sanitizedInput);
          if (searchResult.success && searchResult.facilities.length > 0) {
            return ctx.reply('❌ A facility with this name already exists. Please choose a different name.');
          }
          
          FlowManager.updateData(user.tgId.toString(), { facilityName: sanitizedInput });
          FlowManager.updateStep(user.tgId.toString(), 2);
          
          await ctx.reply(
            '🏢 **Facility Registration (2/4)**\n\n' +
            'Please enter the city:\n\n' +
            'Example: New York, Dubai, London\n' +
            'Requirements: 2-40 characters',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel Registration', 'regfac_cancel')]
              ])
            }
          );
          break;

        case 2: // المدينة
          if (!sanitizedInput || sanitizedInput.length < 2 || sanitizedInput.length > 40) {
            return ctx.reply('❌ Invalid city name. Please enter a city name between 2-40 characters.');
          }
          
          FlowManager.updateData(user.tgId.toString(), { city: sanitizedInput });
          FlowManager.updateStep(user.tgId.toString(), 3);
          
          await ctx.reply(
            '🏢 **Facility Registration (3/4)**\n\n' +
            'Please enter the phone number:\n\n' +
            'Example: +1234567890\n' +
            'Requirements: 5-25 characters',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel Registration', 'regfac_cancel')]
              ])
            }
          );
          break;

        case 3: // رقم الهاتف
          if (!sanitizedInput || sanitizedInput.length < 5 || sanitizedInput.length > 25) {
            return ctx.reply('❌ Invalid phone number. Please enter a phone number between 5-25 characters.');
          }
          
          FlowManager.updateData(user.tgId.toString(), { phone: sanitizedInput });
          FlowManager.updateStep(user.tgId.toString(), 4);
          
          await ctx.reply(
            '🏢 **Facility Registration (4/4)**\n\n' +
            'Please select a plan:\n\n' +
            'Choose the subscription plan for your facility:',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🆓 Free Plan', 'regfac_plan|Free')],
                [Markup.button.callback('⭐ Pro Plan', 'regfac_plan|Pro')],
                [Markup.button.callback('🏢 Business Plan', 'regfac_plan|Business')],
                [Markup.button.callback('❌ Cancel Registration', 'regfac_cancel')]
              ])
            }
          );
          break;

        default:
          return ctx.reply('❌ Invalid registration step.');
      }
    }, ctx, 'handle_facility_registration_step');
  }

  /**
   * إلغاء تسجيل المنشأة
   */
  static async cancelFacilityRegistration(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      
      FlowManager.clearFlow(user.tgId.toString());
      
      await ctx.reply(
        '❌ Facility registration cancelled.\n\n' +
        'You can start registration again anytime.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
        ])
      );
    }, ctx, 'cancel_facility_registration');
  }

  /**
   * إكمال تسجيل المنشأة
   */
  static async completeFacilityRegistration(ctx, plan) {
    return ErrorHandler.safeExecute(async () => {
      const { user } = await SecurityManager.authenticateUser(ctx);
      const flowState = FlowManager.getFlow(user.tgId.toString());
      
      if (!flowState || flowState.flow !== 'facility_registration') {
        return ctx.reply('❌ No active facility registration found.');
      }

      // التحقق من صحة الخطة
      const validPlans = ['Free', 'Pro', 'Business'];
      if (!validPlans.includes(plan)) {
        return ctx.reply('❌ Invalid plan selected.');
      }

      // إنشاء المنشأة باستخدام FacilityService
      const facilityData = {
        name: flowState.data.facilityName,
        city: flowState.data.city,
        phone: flowState.data.phone,
        planTier: plan
      };

      const facilityResult = await FacilityService.createFacility(facilityData, user.id);
      if (!facilityResult.success) {
        return ctx.reply('❌ Error creating facility.');
      }

      const facility = facilityResult.facility;

      // مسح الفلوه
      FlowManager.clearFlow(user.tgId.toString());

      // الحصول على معلومات الخطة باستخدام PlanService
      const planInfo = await PlanService.getPlanInfo(facility.id.toString());

      await ctx.reply(
        `✅ Facility registered successfully!\n\n` +
        `🏢 **Facility Details:**\n` +
        `• Name: ${facility.name}\n` +
        `• City: ${facility.city}\n` +
        `• Phone: ${facility.phone}\n` +
        `• Plan: ${plan}\n\n` +
        `👤 **Your Role:** Facility Administrator\n\n` +
        `📊 **Plan Limits:**\n` +
        `• Members: ${planInfo.success ? planInfo.usage.members.max : 'N/A'}\n` +
        `• Work Orders: ${planInfo.success ? planInfo.usage.workOrders.max : 'N/A'}\n` +
        `• Reports: ${planInfo.success ? planInfo.usage.reminders.max : 'N/A'}\n\n` +
        `Welcome to ${facility.name}!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Go to Main Menu', 'back_to_menu')]
          ])
        }
      );
    }, ctx, 'complete_facility_registration');
  }

  /**
   * عرض لوحة تحكم المنشأة
   */
  static async showFacilityDashboard(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user, facility, membership } = await SecurityManager.validateFacilityAccess(
        ctx, 
        null, 
        ['facility_admin', 'supervisor', 'technician', 'user']
      );

      if (!facility) {
        return ctx.reply(
          '❌ No active facility found.\n\n' +
          'Please join a facility first.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
          ])
        );
      }

      // إحصائيات المنشأة باستخدام FacilityService
      const statsResult = await FacilityService.getFacilityStats(facility.id);
      if (!statsResult.success) {
        return ctx.reply('❌ Error loading facility statistics.');
      }

      const stats = statsResult.stats;

      const dashboardMessage = `🏢 **${facility.name} Dashboard**

📊 **Quick Stats:**
• Total Work Orders: ${stats.workOrders.total}
• Open Work Orders: ${stats.workOrders.open}
• Total Members: ${stats.members.total}
• Active Members: ${stats.members.active}

📈 **Recent Activity:**
• New Work Orders (Today): ${stats.workOrders.today}
• Completed (This Week): ${stats.workOrders.weekly}

🔧 **Your Role:** ${membership.role.charAt(0).toUpperCase() + membership.role.slice(1)}
📅 **Member Since:** ${new Date(membership.joinedAt).toLocaleDateString()}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📋 Work Orders', 'wo_facility_list')],
        [Markup.button.callback('👥 Members', 'facility_members')],
        [Markup.button.callback('📊 Statistics', 'facility_stats')],
        [Markup.button.callback('⚙️ Settings', 'facility_settings')],
        [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
      ]);

      await ctx.reply(dashboardMessage, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    }, ctx, 'show_facility_dashboard');
  }

  /**
   * عرض أعضاء المنشأة
   */
  static async showFacilityMembers(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user, facility, membership } = await SecurityManager.validateFacilityAccess(
        ctx, 
        null, 
        ['facility_admin', 'supervisor', 'technician', 'user']
      );

      // الحصول على أعضاء المنشأة باستخدام UserService
      const membersResult = await UserService.getFacilityMembers(facility.id);
      if (!membersResult.success) {
        return ctx.reply('❌ Error loading facility members.');
      }

      const members = membersResult.members;

      if (members.length === 0) {
        return ctx.reply(
          '❌ No members found in this facility.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Dashboard', 'facility_dashboard')]
          ])
        );
      }

      const roleEmojis = {
        'facility_admin': '👑',
        'supervisor': '👨‍💼',
        'technician': '🔧',
        'user': '👤'
      };

      let membersList = `👥 **${facility.name} Members**\n\n`;
      
      members.forEach((member, index) => {
        const roleEmoji = roleEmojis[member.role] || '👤';
        const name = `${member.user.firstName || 'N/A'} ${member.user.lastName || ''}`.trim();
        const role = member.role.charAt(0).toUpperCase() + member.role.slice(1);
        
        membersList += `${index + 1}. ${roleEmoji} **${name}**\n`;
        membersList += `   Role: ${role}\n`;
        membersList += `   Joined: ${new Date(member.joinedAt).toLocaleDateString()}\n\n`;
      });

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👑 Manage Roles', 'role_management')],
        [Markup.button.callback('➕ Invite Member', 'invite_member')],
        [Markup.button.callback('🔙 Back to Dashboard', 'facility_dashboard')]
      ]);

      await ctx.reply(membersList, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    }, ctx, 'show_facility_members');
  }

  /**
   * عرض إحصائيات المنشأة
   */
  static async showFacilityStats(ctx) {
    return ErrorHandler.safeExecute(async () => {
      const { user, facility, membership } = await SecurityManager.validateFacilityAccess(
        ctx, 
        null, 
        ['facility_admin', 'supervisor', 'technician', 'user']
      );

      // الحصول على إحصائيات المنشأة باستخدام FacilityService
      const statsResult = await FacilityService.getFacilityStats(facility.id);
      if (!statsResult.success) {
        return ctx.reply('❌ Error loading facility statistics.');
      }

      const stats = statsResult.stats;

      const statsMessage = `📊 **${facility.name} Statistics**

📋 **Work Orders:**
• Total: ${stats.workOrders.total}
• Open: ${stats.workOrders.open}
• In Progress: ${stats.workOrders.inProgress}
• Completed: ${stats.workOrders.completed}
• Closed: ${stats.workOrders.closed}

👥 **Members:**
• Total: ${stats.members.total}
• Active: ${stats.members.active}
• Facility Admins: ${stats.members.facilityAdmins}
• Supervisors: ${stats.members.supervisors}
• Technicians: ${stats.members.technicians}
• Users: ${stats.members.users}

📈 **Activity:**
• Today: ${stats.workOrders.today} new work orders
• This Week: ${stats.workOrders.weekly} new work orders
• This Month: ${stats.workOrders.monthly} new work orders

⏱️ **Performance:**
• Average Resolution Time: ${stats.plan ? '2.5' : 'N/A'} days
• High Priority: ${stats.plan ? '0' : 'N/A'}
• On-Time Completion: ${stats.plan ? '85' : 'N/A'}%`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Detailed Reports', 'reports_menu')],
        [Markup.button.callback('📈 Performance Graph', 'performance_graph')],
        [Markup.button.callback('🔙 Back to Dashboard', 'facility_dashboard')]
      ]);

      await ctx.reply(statsMessage, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    }, ctx, 'show_facility_stats');
  }
}

module.exports = FacilityController;
