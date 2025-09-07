const { Markup } = require('telegraf');
const { PrismaClient } = require('@prisma/client');
const SecurityManager = require('../utils/security');

const prisma = new PrismaClient();

class MainMenuController {
  /**
   * Generates the main menu buttons based on user role and facility status.
   * @param {object} user - The user object from the database.
   * @param {object} facilityUser - The facility-user link object.
   * @returns {Array<Array<object>>} A 2D array of button objects for Telegraf.
   */
  static async getMainMenuButtons(user, facilityUser) {
    const buttons = [];

    if (user.status === 'active' && facilityUser) {
      // --- Logged-in User with an Active Facility ---
      
      // Row 1: New Work Order (always visible for active users)
      buttons.push([Markup.button.callback('➕ New Work Order', 'wo_new')]);

      // Row 2: View Work Orders (different views by role)
      if (['supervisor', 'master', 'admin'].includes(facilityUser.role)) {
        buttons.push([Markup.button.callback('📋 View All Work Orders', 'wo_view_all')]);
      } else if (facilityUser.role === 'technician') {
        buttons.push([Markup.button.callback('📋 My Assigned Work Orders', 'wo_view_assigned')]);
      } else { // 'user' role
        buttons.push([Markup.button.callback('📋 My Work Orders', 'wo_view_my')]);
      }

      // Row 3: Admin & Reports (for privileged roles)
      const adminButtons = [];
      if (['admin', 'master', 'supervisor'].includes(facilityUser.role)) {
        adminButtons.push(Markup.button.callback('👑 Admin Panel', 'admin_panel'));
      }
      if (['admin', 'master', 'supervisor', 'technician'].includes(facilityUser.role)) {
         adminButtons.push(Markup.button.callback('📊 Reports', 'reports_panel'));
      }
       if (adminButtons.length > 0) {
        buttons.push(adminButtons);
      }


      // Row 4: Switch Facility & Settings
      const settingsButtons = [];
      settingsButtons.push(Markup.button.callback('⚙️ Settings', 'settings_panel'));
      const userFacilities = await prisma.facilityUser.count({ where: { userId: user.id } });
      if (userFacilities > 1) {
        settingsButtons.push(Markup.button.callback('🏢 Switch Facility', 'switch_facility_start'));
      }
      buttons.push(settingsButtons);

    } else {
      // --- New or Unaffiliated User ---
      buttons.push([
        Markup.button.callback('🏢 Register a New Facility', 'reg_fac_start'),
      ]);
      buttons.push([
        Markup.button.callback('🔗 Join an Existing Facility', 'join_fac_start'),
      ]);
    }

    // Final Row: Help button for everyone
    buttons.push([Markup.button.callback('❓ Help', 'help')]);

    return buttons;
  }
}

module.exports = MainMenuController;
