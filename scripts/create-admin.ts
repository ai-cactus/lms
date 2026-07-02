import { prisma } from '@/db/index';
import { UserRole } from '@/generated/prisma/enums';
import bcrypt from 'bcryptjs';

async function main() {
  try {
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@theraptly.com';

    // SECURITY: never ship a hardcoded admin password. The password MUST be
    // supplied via the environment (reuses SYSTEM_ADMIN_PASSWORD, or override
    // with SEED_ADMIN_PASSWORD). Refuse to run otherwise.
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || process.env.SYSTEM_ADMIN_PASSWORD;
    if (!adminPassword) {
      console.error(
        'Refusing to seed admin: set SEED_ADMIN_PASSWORD (or SYSTEM_ADMIN_PASSWORD) in the environment.',
      );
      process.exitCode = 1;
      return;
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        password: hashedPassword,
        role: UserRole.supervisor,
        profile: {
          create: {
            email: adminEmail,
            firstName: 'Admin',
            lastName: 'User',
            fullName: 'Admin User',
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
