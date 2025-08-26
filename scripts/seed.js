// scripts/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1) منشأة افتراضية مفعّلة
  const facility = await prisma.facility.upsert({
    where: { name: 'Default Facility' },
    update: { isActive: true, isDefault: true, planTier: 'Free' },
    create: { 
      name: 'Default Facility', 
      city: 'N/A',
      phone: '',
      isActive: true, 
      isDefault: true, 
      planTier: 'Free' 
    },
  });

  // ⬅️ غيّر القيمة دي لتليجرام ID بتاعك (رقم فقط)
  const YOUR_TG_ID = BigInt(7103238318);

  // 2) يوزر رئيسي (أنت) بحالة active
  const user = await prisma.user.upsert({
    where: { tgId: YOUR_TG_ID },
    update: { status: 'active', activeFacilityId: facility.id },
    create: {
      tgId: YOUR_TG_ID,
      firstName: 'Owner',
      status: 'active',
      activeFacilityId: facility.id,
      requestedRole: 'facility_admin'
    },
  });

  // 3) عضوية كـ facility_admin
  await prisma.facilityMember.upsert({
    where: { userId_facilityId: { userId: user.id, facilityId: facility.id } },
    update: { role: 'facility_admin' },
    create: { userId: user.id, facilityId: facility.id, role: 'facility_admin' },
  });

  console.log('✅ Seed done:', { facility: facility.id.toString(), user: user.id.toString() });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
