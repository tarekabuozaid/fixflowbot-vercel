# FixFlowBot Final Version

This repository contains an improved implementation of the FixFlowBot tailored for the **Fix Flow Bot – النسخة الاحترافية (Professional Roadmap)**.  It delivers a streamlined facilities‑management bot powered by [Telegraf](https://telegraf.js.org/) and [Prisma](https://www.prisma.io/).

## Features

- **User Management** – Users are created on demand when they message the bot.  Each user has a Telegram ID, status (`pending`/`active`/`blocked`) and can belong to multiple facilities.
- **Facility Registration** – Unregistered users can start a guided registration flow (`Register Facility`) which collects a facility name, city, phone and subscription plan.  A facility admin is created for the registrant and a notification is sent to the master for activation.
- **Join Facility** – Users may request membership in an existing active facility.  A switch request is recorded and must be approved by the master before the user is activated and added as a member.
- **Work Orders** – Active members can create new work orders with a simple description.  They can list their own work orders and check statuses.  Additional metadata (department, priority, location, assignments and images) can be added later.
- **Master Panel** – A special set of actions for the system owner (`MASTER_ID` in the environment) to view and approve pending facilities and membership requests directly from Telegram.
- **Database Schema** – The Prisma schema introduces new fields for `city` and `phone` on the `Facility` model and keeps track of membership, work orders and status history according to the professional roadmap.

## Getting Started

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Configure the environment**:

   Copy `env.example` to `.env` and fill in your Telegram bot token, master user ID and a PostgreSQL connection URL.

3. **Generate the Prisma client and migrate**:

   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

4. **Run the bot locally**:

   ```bash
   npm start
   ```

   The bot will connect to Telegram and wait for incoming messages.  Use `/start` to begin interacting.

## Notes

- This implementation is designed for clarity and maintainability rather than covering every possible edge case.  It can be extended to support departments, priorities, file attachments, and escalations as needed.
- You must create the database and set the `DATABASE_URL` before running migrations.
- To deploy on Vercel, add a `vercel.json` that points to `index.js` as a serverless function, or run the bot as a standalone service.

## Professional Enhancements

The codebase lays the groundwork for advanced features described in the roadmap, including:

- Workflows & SLA escalation.
- KPI dashboards and reporting.
- Audit logs and enhanced security.

These can be developed iteratively by adding new models to `schema.prisma` and corresponding bot commands.