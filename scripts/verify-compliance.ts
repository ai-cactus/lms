import { prisma } from '@/db/index';
import { createJob } from '../src/lib/jobs';
import { scanText } from '../src/lib/documents/phiScanner';
import { suggestMappings } from '../src/lib/mapping';
import { logger } from '@/lib/logger';

async function main() {
  logger.info({ msg: '[verify-compliance] Starting Verification...' });

  logger.info({ msg: '[verify-compliance] 1. Creating Organization & User...' });
  const org = await prisma.organization.create({
    data: { name: 'Test Org', slug: `test-org-${Date.now()}` },
  });
  const facility = await prisma.facility.create({
    data: { organizationId: org.id, name: 'Test Facility' },
  });
  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      password: 'hashed_password',
    },
  });
  const orgUser = await prisma.organizationUser.create({
    data: { userId: user.id, organizationId: org.id, role: 'supervisor' },
  });
  await prisma.organizationUserFacility.create({
    data: { organizationUserId: orgUser.id, facilityId: facility.id },
  });
  logger.info({ msg: `[verify-compliance] User created: ${user.email} (${user.id})` });

  logger.info({ msg: '[verify-compliance] 2. Testing Document Logic...' });
  const text = 'Patient John Doe (DOB: 01/01/1980) Policy regarding safety.';
  const phi = await scanText(text);
  logger.info({ msg: `[verify-compliance] PHI Detected: ${phi.hasPHI}`, findings: phi.findings });

  const doc = await prisma.document.create({
    data: {
      organizationId: org.id,
      organizationUserId: orgUser.id,
      filename: 'policy.txt',
      originalName: 'policy.txt',
      mimeType: 'text/plain',
      size: text.length,
    },
  });

  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      version: 1,
      storagePath: '/tmp/mock',
      hash: 'mock_hash',
      content: text,
    },
  });
  logger.info({ msg: `[verify-compliance] Document Version created: ${version.id}` });

  logger.info({ msg: '[verify-compliance] 3. Testing Mapping Suggestions...' });
  const mappings = await suggestMappings(text);
  logger.info({ msg: `[verify-compliance] Suggestions found: ${mappings.length}` });

  logger.info({ msg: '[verify-compliance] 4. Testing Course Generation Job...' });
  const job = await createJob('GENERATE_DRAFT', {
    documentVersionId: version.id,
    userId: user.id,
  });
  logger.info({ msg: `[verify-compliance] Job Queued: ${job.id}` });

  logger.info({ msg: '[verify-compliance] Waiting for job processing...' });
  await new Promise((r) => setTimeout(r, 7000));

  const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
  logger.info({ msg: `[verify-compliance] Job Status: ${updatedJob?.status}` });

  const course = await prisma.course.findFirst({ where: { createdByOrgUserId: orgUser.id } });
  if (course) {
    logger.info({ msg: `[verify-compliance] SUCCESS: Course Created: "${course.title}"` });
  } else {
    logger.error({ msg: '[verify-compliance] FAILURE: No course created.' });
  }

  logger.info({ msg: '[verify-compliance] Verification Complete.' });
}

main()
  .catch((e) => logger.error({ msg: '[verify-compliance] Failed', err: e }))
  .finally(async () => {
    await prisma.$disconnect();
  });
