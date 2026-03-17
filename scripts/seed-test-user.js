const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // Create org
  const org = await prisma.organization.upsert({
    where: { slug: 'test-org' },
    update: { hasAuditorAccess: true },
    create: {
      name: 'Test Organization',
      slug: 'test-org',
      hasAuditorAccess: true,
    },
  });
  console.log('Org:', org.id, '|', org.name, '| hasAuditorAccess:', org.hasAuditorAccess);

  // Create admin user
  const hashed = await bcrypt.hash('Admin123!', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: { password: hashed, organizationId: org.id, role: 'admin', emailVerified: true },
    create: {
      email: 'admin@test.com',
      password: hashed,
      role: 'admin',
      emailVerified: true,
      organizationId: org.id,
    },
  });
  console.log('Admin:', admin.email, '| role:', admin.role);

  // Create profile for admin
  await prisma.profile.upsert({
    where: { id: admin.id },
    update: { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: admin.email },
    create: {
      id: admin.id,
      email: admin.email,
      firstName: 'Jane',
      lastName: 'Doe',
      fullName: 'Jane Doe',
    },
  });

  // Create 3 worker users
  const workerHash = await bcrypt.hash('Worker123!', 10);
  for (let i = 1; i <= 3; i++) {
    const w = await prisma.user.upsert({
      where: { email: `worker${i}@test.com` },
      update: {},
      create: {
        email: `worker${i}@test.com`,
        password: workerHash,
        role: 'worker',
        emailVerified: true,
        organizationId: org.id,
      },
    });
    await prisma.profile.upsert({
      where: { id: w.id },
      update: {},
      create: {
        id: w.id,
        email: w.email,
        firstName: 'Worker',
        lastName: `${i}`,
        fullName: `Worker ${i}`,
      },
    });
  }
  console.log('3 workers created');
  console.log('\n✅ Done! Login: admin@test.com / Admin123!');
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
