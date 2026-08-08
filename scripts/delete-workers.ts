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
    console.log(`\nOrg: ${org.name} (${org.id})`);
    console.log(`Workers: ${org.organizationUsers.length}`);
    org.organizationUsers.forEach((m) => console.log(`  - ${m.user.email} (${m.role})`));
  }

  const allWorkerMemberships = orgs.flatMap((o) => o.organizationUsers);
  console.log(`\nTotal worker memberships to delete: ${allWorkerMemberships.length}`);

  if (allWorkerMemberships.length === 0) {
    console.log('No workers found.');
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
    console.log('\n[DRY RUN] Would delete:');
    console.log(`  quiz attempts:  ${attempts}`);
    console.log(`  enrollments:    ${enrollments}`);
    console.log(`  courses:        ${courses}`);
    console.log(`  workers:        ${workerUserIds.length}`);
    console.log('\n[DRY RUN] Nothing was deleted. Re-run without --dry-run to execute.');
    return;
  }

  console.log('\nDeleting quiz attempts...');
  const deletedAttempts = await prisma.quizAttempt.deleteMany({
    where: { enrollment: { organizationUser: { userId: { in: workerUserIds } } } },
  });
  console.log(`  Deleted ${deletedAttempts.count} quiz attempts`);

  console.log('Deleting enrollments...');
  const deletedEnrollments = await prisma.enrollment.deleteMany({
    where: { organizationUser: { userId: { in: workerUserIds } } },
  });
  console.log(`  Deleted ${deletedEnrollments.count} enrollments`);

  // Course.creator is onDelete: Restrict, so a membership that authored a
  // course (not expected for a worker role, but not enforced at the DB level
  // either) would otherwise abort the user deletion below.
  console.log('Deleting authored courses...');
  const deletedCourses = await prisma.course.deleteMany({
    where: { creator: { userId: { in: workerUserIds } } },
  });
  console.log(`  Deleted ${deletedCourses.count} courses`);

  console.log('Deleting workers...');
  const deletedUsers = await prisma.user.deleteMany({
    where: { id: { in: workerUserIds } },
  });
  console.log(`  Deleted ${deletedUsers.count} workers`);

  console.log('\nDone!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
