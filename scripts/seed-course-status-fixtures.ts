/**
 * QA fixture seed — one `draft` and one `inactive` course for an organization.
 *
 * Neither status can be produced through the UI on demand: a Course row is only
 * created when the wizard publishes, and `draft` is set only on a real content
 * shortfall. So the Draft and Inactive badges on the course lists cannot be QA'd
 * live without seeding the rows directly (TOOL-16).
 *
 * The courses are bare rows — no modules, lessons or quiz — for exercising the
 * LIST badges only. Opening one shows an empty course.
 *
 * Idempotent: each course's id is derived from the org id and its status, so a
 * re-run updates the same two rows instead of adding more. Nothing else is
 * touched and nothing is deleted.
 *
 * Refuses to run unless APP_URL points at localhost or a `staging…` host, so a
 * copied production env file cannot seed fixtures into production.
 *
 * Usage (local: export an env file first; on staging: npm run script staging <file> <args>):
 *   npx tsx scripts/seed-course-status-fixtures.ts --org-id=<organizationId>
 *   npx tsx scripts/seed-course-status-fixtures.ts --org-id=<organizationId> --dry-run
 *
 * The owner membership of the org is recorded as the courses' creator.
 */
import { createHash } from 'node:crypto';
import { prisma } from '@/db/index';
import type { CourseStatus } from '@/generated/prisma/enums';
import { logger } from '@/lib/logger';

const DRY_RUN = process.argv.includes('--dry-run');
const ORG_ID = process.argv.find((a) => a.startsWith('--org-id='))?.slice('--org-id='.length);

const FIXTURES: ReadonlyArray<{ status: CourseStatus; title: string }> = [
  { status: 'draft', title: '[QA fixture] Draft course' },
  { status: 'inactive', title: '[QA fixture] Inactive course' },
];

function isNonProductionAppUrl(appUrl: string | undefined): boolean {
  if (!appUrl) return false;
  let host: string;
  try {
    host = new URL(appUrl).hostname;
  } catch {
    return false;
  }
  return host === 'localhost' || host === '127.0.0.1' || host.startsWith('staging');
}

/** A stable RFC-4122-shaped id, so re-runs upsert the same row. */
function fixtureCourseId(organizationId: string, status: CourseStatus): string {
  const hex = createHash('sha256')
    .update(`qa-course-status-fixture:${organizationId}:${status}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

async function main(): Promise<void> {
  if (!isNonProductionAppUrl(process.env.APP_URL)) {
    logger.error({
      msg: '[seed-course-status-fixtures] Refusing to run: APP_URL must be localhost or a staging host',
      appUrl: process.env.APP_URL ?? null,
    });
    process.exitCode = 1;
    return;
  }
  if (!ORG_ID) {
    logger.error({
      msg: '[seed-course-status-fixtures] Usage: seed-course-status-fixtures.ts --org-id=<organizationId> [--dry-run]',
    });
    process.exitCode = 1;
    return;
  }

  const owner = await prisma.organizationUser.findFirst({
    where: { organizationId: ORG_ID, role: 'owner' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    logger.error({
      msg: '[seed-course-status-fixtures] No owner membership found for the organization',
      orgId: ORG_ID,
    });
    process.exitCode = 1;
    return;
  }

  for (const { status, title } of FIXTURES) {
    const id = fixtureCourseId(ORG_ID, status);
    if (DRY_RUN) {
      logger.info({
        msg: '[seed-course-status-fixtures] [DRY RUN] Would upsert course',
        courseId: id,
        status,
        orgId: ORG_ID,
      });
      continue;
    }
    await prisma.course.upsert({
      where: { id },
      update: { title, status, archivedAt: null, archivedByOrgUserId: null },
      create: {
        id,
        title,
        description: `QA fixture for the ${status} course-list badge. Safe to delete.`,
        status,
        organizationId: ORG_ID,
        createdByOrgUserId: owner.id,
      },
    });
    logger.info({
      msg: '[seed-course-status-fixtures] Course upserted',
      courseId: id,
      status,
      orgId: ORG_ID,
    });
  }
}

main()
  .catch((err) => {
    logger.error({ msg: '[seed-course-status-fixtures] Failed', err });
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
