/*
 * seed-test-user.ts — seeds a test organisation with one admin + three workers
 * and a sample document, for local/e2e use.
 *
 * Usage (local: export an env file first; on a server: npm run script <staging|production> <file>):
 *   npx tsx scripts/seed-test-user.ts
 */
import { prisma } from '@/db/index';
import { UserRole } from '@/generated/prisma/enums';
import bcrypt from 'bcryptjs';

async function main() {
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

  // Create admin user — the founding/primary admin of the org is the `owner`.
  const hashed = await bcrypt.hash('Admin123!', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: { password: hashed, organizationId: org.id, role: UserRole.owner, emailVerified: true },
    create: {
      email: 'admin@test.com',
      password: hashed,
      role: UserRole.owner,
      emailVerified: true,
      organizationId: org.id,
    },
  });
  console.log('Admin:', admin.email, '| role:', admin.role);

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

  const workerHash = await bcrypt.hash('Worker123!', 10);
  // Seed a spread of worker-category roles for fixture variety.
  const workerRoles: UserRole[] = [
    UserRole.therapist_clinician,
    UserRole.nurse,
    UserRole.front_desk_admin,
  ];
  for (let i = 1; i <= 3; i++) {
    const w = await prisma.user.upsert({
      where: { email: `worker${i}@test.com` },
      update: {},
      create: {
        email: `worker${i}@test.com`,
        password: workerHash,
        role: workerRoles[i - 1],
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
  // Create a document and version for the admin to use in the wizard
  console.log('Creating sample document for admin');
  const doc = await prisma.document.upsert({
    where: { id: 'test-doc-id-01' },
    update: {},
    create: {
      id: 'test-doc-id-01',
      userId: admin.id,
      filename: 'HIPAA_Compliance_Guide.pdf',
      originalName: 'HIPAA_Compliance_Guide.pdf',
      mimeType: 'application/pdf',
      size: 1024 * 1024, // 1MB
    },
  });

  await prisma.documentVersion.upsert({
    where: { id: 'test-doc-version-id-01' },
    update: {},
    create: {
      id: 'test-doc-version-id-01',
      documentId: doc.id,
      version: 1,
      storagePath: 'documents/test-guideline.pdf',
      hash: 'dummy-hash-123',
      content: 'This is a sample HIPAA compliance document content for training purposes.',
    },
  });

  console.log('3 workers created');
  console.log('\n✅ Done! Login: admin@test.com / Admin123!');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
