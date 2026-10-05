import { prisma } from '@/db/index';
import { logger, maskEmail } from '@/lib/logger';
import { createJob } from '../src/lib/jobs';
import { scanText, type PHIFinding } from '../src/lib/documents/phiScanner';
import { suggestMappings } from '../src/lib/mapping';

/**
 * SEC-11: a scan result is logged as counts per PHI type only. Findings carry
 * character offsets into the scanned text, which locate the matched PHI, so
 * neither they nor the text itself may reach a log.
 */
function summarizeFindings(findings: PHIFinding[]): Record<string, number> {
  const byType: Record<string, number> = {};
  for (const finding of findings) {
    byType[finding.type] = (byType[finding.type] ?? 0) + 1;
  }
  return byType;
}

async function main() {
  logger.info({ msg: '[verify-compliance] Starting verification' });

  logger.info({ msg: '[verify-compliance] 1. Creating organization and user' });
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
  logger.info({
    msg: '[verify-compliance] User created',
    userId: user.id,
    email: maskEmail(user.email),
  });

  logger.info({ msg: '[verify-compliance] 2. Testing document logic' });
  const text = 'Patient John Doe (DOB: 01/01/1980) Policy regarding safety.';
  const phi = await scanText(text);
  logger.info({
    msg: '[verify-compliance] PHI scan result',
    hasPHI: phi.hasPHI,
    findingCount: phi.findings.length,
    findingsByType: summarizeFindings(phi.findings),
    decidedBy: phi.decidedBy,
  });

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
  logger.info({
    msg: '[verify-compliance] Document version created',
    documentId: doc.id,
    versionId: version.id,
  });

  logger.info({ msg: '[verify-compliance] 3. Testing mapping suggestions' });
  const mappings = await suggestMappings(text);
  logger.info({
    msg: '[verify-compliance] Mapping suggestions found',
    suggestionCount: mappings.length,
  });

  logger.info({ msg: '[verify-compliance] 4. Testing course generation job' });
  const job = await createJob('GENERATE_DRAFT', {
    documentVersionId: version.id,
    userId: user.id,
  });
  logger.info({ msg: '[verify-compliance] Job queued, waiting for processing', jobId: job.id });

  await new Promise((r) => setTimeout(r, 7000));

  const updatedJob = await prisma.job.findUnique({ where: { id: job.id } });
  logger.info({ msg: '[verify-compliance] Job status', jobId: job.id, status: updatedJob?.status });

  const course = await prisma.course.findFirst({ where: { createdByOrgUserId: orgUser.id } });
  if (course) {
    logger.info({ msg: '[verify-compliance] SUCCESS: course created', courseId: course.id });
  } else {
    logger.error({ msg: '[verify-compliance] FAILURE: no course created', jobId: job.id });
  }

  logger.info({ msg: '[verify-compliance] Verification complete' });
}

main()
  .catch((err) => logger.error({ msg: '[verify-compliance] Verification failed', err }))
  .finally(async () => {
    await prisma.$disconnect();
  });
