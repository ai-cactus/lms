const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  try {
    const adminEmail = 'admin@theraptly.com';
    const hashedPassword = await bcrypt.hash('AdminPassword123!', 10);

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        password: hashedPassword,
        profile: {
          create: {
            email: adminEmail,
            firstName: 'Admin',
            lastName: 'User',
            fullName: 'Admin User',
            role: 'admin',
          },
        },
      },
    });

    console.log(`Admin user created/verified: ${admin.email}`);
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
