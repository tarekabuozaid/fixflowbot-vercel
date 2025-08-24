// scripts/test-bot.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testBot() {
  try {
    console.log('🧪 Testing Bot Configuration...\n');

    // Test database connection
    console.log('1. Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Test environment variables
    console.log('\n2. Testing environment variables...');
    const requiredVars = ['BOT_TOKEN', 'PUBLIC_URL', 'MASTER_ID', 'DATABASE_URL'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.log('❌ Missing environment variables:', missingVars.join(', '));
    } else {
      console.log('✅ All environment variables are set');
    }

    // Test data integrity
    console.log('\n3. Testing data integrity...');
    const [userCount, facilityCount, memberCount] = await Promise.all([
      prisma.user.count(),
      prisma.facility.count(),
      prisma.facilityMember.count()
    ]);

    console.log(`   Users: ${userCount}`);
    console.log(`   Facilities: ${facilityCount}`);
    console.log(`   Memberships: ${memberCount}`);

    // Test master user
    if (process.env.MASTER_ID) {
      const masterUser = await prisma.user.findUnique({
        where: { tgId: BigInt(process.env.MASTER_ID) }
      });
      
      if (masterUser) {
        console.log(`✅ Master user found: ${masterUser.firstName} (ID: ${masterUser.id})`);
      } else {
        console.log('⚠️ Master user not found in database');
      }
    }

    // Test default facility
    const defaultFacility = await prisma.facility.findFirst({
      where: { isDefault: true }
    });

    if (defaultFacility) {
      console.log(`✅ Default facility: ${defaultFacility.name} (ID: ${defaultFacility.id})`);
    } else {
      console.log('⚠️ No default facility found');
    }

    console.log('\n🎉 Bot test completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Test /start from a new account');
    console.log('2. Test /master from your account');
    console.log('3. Test facility registration flow');
    console.log('4. Test join request flow');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testBot();
