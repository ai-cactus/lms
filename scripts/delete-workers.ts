/*
 * delete-workers.ts — hard-deletes every identity holding a worker-category
 * membership, together with their quiz attempts, enrollments and authored
 * courses.
 *
 * Usage:
 *   npx tsx scripts/delete-workers.ts --dry-run   # report only
 *   npx tsx scripts/delete-workers.ts             # delete
 *
 * Flags:
 *   --dry-run   Report what would be deleted, write nothing.
 */
import { prisma } from '@/db/index';
import { WORKER_ROLES } from '@/lib/rbac/role-utils';
import { logger } from '@/lib/logger';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const orgs = await prisma.organization.findMany({
    include: {
      organizationUsers: {
        where: { role: { in: [...WORKER_ROLES] } },
        select: { id: true, userId: true, role: true, user: { select: { email: true } } },
      },
    },
  });

  for (const org of orgs) {
    logger.info({ msg: `[delete-workers] Org: ${org.name} (${org.id})` });
    logger.info({ msg: `[delete-workers] Workers: ${org.organizationUsers.length}` });
    org.organizationUsers.forEach((m) =>
      logger.info({ msg: `[delete-workers] - ${m.user.email} (${m.role})` }),
    );
  }

  const allWorkerMemberships = orgs.flatMap((o) => o.organizationUsers);
  logger.info({
    msg: `[delete-workers] Total worker memberships to delete: ${allWorkerMemberships.length}`,
  });

  if (allWorkerMemberships.length === 0) {
    logger.info({ msg: '[delete-workers] No workers found.' });
    return;
  }

  // Distinct identities behind those memberships. Deleting the User cascades
  // EVERY membership it holds, across all orgs — not just the worker-role one
  // found here. That matches this script's original single-org-per-user
  // assumption, but for a genuinely multi-org user it would also remove their
  // other, non-worker memberships.
  const workerUserIds = [...new Set(allWorkerMemberships.map((m) => m.userId))];

  if (DRY_RUN) {
    const [attempts, enrollments, courses] = await Promise.all([
      prisma.quizAttempt.count({
        where: { enrollment: { organizationUser: { userId: { in: workerUserIds } } } },
      }),
      prisma.enrollment.count({
        where: { organizationUser: { userId: { in: workerUserIds } } },
      }),
      prisma.course.count({ where: { creator: { userId: { in: workerUserIds } } } }),
    ]);
    logger.info({ msg: '[delete-workers] [DRY RUN] Would delete' });
    logger.info({ msg: `[delete-workers] quiz attempts:  ${attempts}` });
    logger.info({ msg: `[delete-workers] enrollments:    ${enrollments}` });
    logger.info({ msg: `[delete-workers] courses:        ${courses}` });
    logger.info({ msg: `[delete-workers] workers:        ${workerUserIds.length}` });
    logger.info({
      msg: '[delete-workers] [DRY RUN] Nothing was deleted. Re-run without --dry-run to execute.',
    });
    return;
  }

  logger.info({ msg: '[delete-workers] Deleting quiz attempts...' });
  const deletedAttempts = await prisma.quizAttempt.deleteMany({
    where: { enrollment: { organizationUser: { userId: { in: workerUserIds } } } },
  });
  logger.info({ msg: `[delete-workers] Deleted ${deletedAttempts.count} quiz attempts` });

  logger.info({ msg: '[delete-workers] Deleting enrollments...' });
  const deletedEnrollments = await prisma.enrollment.deleteMany({
    where: { organizationUser: { userId: { in: workerUserIds } } },
  });
  logger.info({ msg: `[delete-workers] Deleted ${deletedEnrollments.count} enrollments` });

  // Course.creator is onDelete: Restrict, so a membership that authored a
  // course (not expected for a worker role, but not enforced at the DB level
  // either) would otherwise abort the user deletion below.
  logger.info({ msg: '[delete-workers] Deleting authored courses...' });
  const deletedCourses = await prisma.course.deleteMany({
    where: { creator: { userId: { in: workerUserIds } } },
  });
  logger.info({ msg: `[delete-workers] Deleted ${deletedCourses.count} courses` });

  logger.info({ msg: '[delete-workers] Deleting workers...' });
  const deletedUsers = await prisma.user.deleteMany({
    where: { id: { in: workerUserIds } },
  });
  logger.info({ msg: `[delete-workers] Deleted ${deletedUsers.count} workers` });

  logger.info({ msg: '[delete-workers] Done!' });
}

main()
  .catch((e) => {
    logger.error({ msg: '[delete-workers] Failed', err: e });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
