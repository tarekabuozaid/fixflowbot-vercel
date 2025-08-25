// scripts/verify-import.js
// سكربت للتحقق من البيانات المستوردة من ملف الإكسيل
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyImport() {
  try {
    console.log('🔍 Verifying imported data...\n');

    // 1. إحصائيات عامة
    console.log('📊 General Statistics:');
    const [userCount, facilityCount, memberCount, woCount, historyCount] = await Promise.all([
      prisma.user.count(),
      prisma.facility.count(),
      prisma.facilityMember.count(),
      prisma.workOrder.count(),
      prisma.statusHistory.count()
    ]);

    console.log(`   Users: ${userCount}`);
    console.log(`   Facilities: ${facilityCount}`);
    console.log(`   Memberships: ${memberCount}`);
    console.log(`   Work Orders: ${woCount}`);
    console.log(`   Status History: ${historyCount}\n`);

    // 2. تفاصيل المستخدمين
    console.log('👥 Recent Users:');
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    users.forEach(u => {
      console.log(`   ${u.id}: ${u.firstName || 'N/A'} (tg: ${u.tgId}) - ${u.status}`);
    });
    console.log();

    // 3. تفاصيل المنشآت
    console.log('🏢 Facilities:');
    const facilities = await prisma.facility.findMany({
      orderBy: { createdAt: 'desc' }
    });
    facilities.forEach(f => {
      console.log(`   ${f.id}: ${f.name} - ${f.isActive ? 'Active' : 'Inactive'} (${f.planTier})`);
    });
    console.log();

    // 4. العضويات
    console.log('👥 Recent Memberships:');
    const memberships = await prisma.facilityMember.findMany({
      include: {
        user: true,
        facility: true
      },
      orderBy: { id: 'desc' },
      take: 5
    });
    memberships.forEach(m => {
      console.log(`   ${m.user.firstName || 'N/A'} → ${m.facility.name} (${m.role})`);
    });
    console.log();

    // 5. طلبات الصيانة
    console.log('🔧 Recent Work Orders:');
    const workOrders = await prisma.workOrder.findMany({
      include: {
        facility: true,
        byUser: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    workOrders.forEach(wo => {
      console.log(`   #${wo.id}: ${wo.status} - ${wo.description?.slice(0, 40)}... (${wo.facility.name})`);
    });
    console.log();

    // 6. سجل التغييرات
    console.log('📅 Recent Status Changes:');
    const history = await prisma.statusHistory.findMany({
      include: {
        workOrder: true,
        updatedByUser: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    history.forEach(h => {
      console.log(`   WO#${h.workOrderId}: ${h.oldStatus} → ${h.newStatus} (by ${h.updatedByUser.firstName || 'N/A'})`);
    });
    console.log();

    // 7. إحصائيات الحالات
    console.log('📈 Work Order Status Distribution:');
    const statusStats = await prisma.workOrder.groupBy({
      by: ['status'],
      _count: { status: true }
    });
    statusStats.forEach(s => {
      console.log(`   ${s.status}: ${s._count.status}`);
    });
    console.log();

    // 8. إحصائيات الأولويات
    console.log('📈 Priority Distribution:');
    const priorityStats = await prisma.workOrder.groupBy({
      by: ['priority'],
      _count: { priority: true },
      where: { priority: { not: null } }
    });
    priorityStats.forEach(p => {
      console.log(`   ${p.priority}: ${p._count.priority}`);
    });
    console.log();

    // 9. إحصائيات الأقسام
    console.log('📈 Department Distribution:');
    const deptStats = await prisma.workOrder.groupBy({
      by: ['department'],
      _count: { department: true },
      where: { department: { not: null } }
    });
    deptStats.forEach(d => {
      console.log(`   ${d.department}: ${d._count.department}`);
    });

    console.log('\n✅ Verification completed successfully!');

  } catch (error) {
    console.error('❌ Verification failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyImport();
