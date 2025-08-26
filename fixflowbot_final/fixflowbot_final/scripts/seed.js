const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Create a default facility
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
    }
  });

  // Change this to your Telegram ID to seed a master/admin user
  const YOUR_TG_ID = BigInt(process.env.MASTER_ID || 0);

  if (YOUR_TG_ID) {
    const user = await prisma.user.upsert({
      where: { tgId: YOUR_TG_ID },
      update: { status: 'active', activeFacilityId: facility.id },
      create: {
        tgId: YOUR_TG_ID,
        firstName: 'Master',
        status: 'active',
        activeFacilityId: facility.id,
        requestedRole: 'facility_admin'
      }
    });

    await prisma.facilityMember.upsert({
      where: { userId_facilityId: { userId: user.id, facilityId: facility.id } },
      update: { role: 'facility_admin' },
      create: { userId: user.id, facilityId: facility.id, role: 'facility_admin' }
    });

    console.log('Seeded default facility and master user.');
  } else {
    console.log('Set MASTER_ID environment variable to seed the admin user.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });