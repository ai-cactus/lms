/*
 * delete-workers.ts — soft-deletes every identity holding an ACTIVE
 * worker-category membership, through the same shared `softDeleteUser` the
 * /system console uses (Q-23, RISK-14). Enrollments, quiz attempts,
 * certificates and authored content are retained; nothing is hard-deleted.
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
import { logger, maskEmail } from '@/lib/logger';
import { rateLimiterRedis } from '@/lib/rate-limit';
import { softDeleteUser } from '@/lib/system/delete-user';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const orgs = await prisma.organization.findMany({
    include: {
      organizationUsers: {
        where: { role: { in: [...WORKER_ROLES] }, active: true, user: { deletedAt: null } },
        select: { id: true, userId: true, role: true, user: { select: { email: true } } },
      },
    },
  });

  for (const org of orgs) {
    logger.info({ msg: `[delete-workers] Org: ${org.name} (${org.id})` });
    logger.info({ msg: `[delete-workers] Workers: ${org.organizationUsers.length}` });
    org.organizationUsers.forEach((m) =>
      logger.info({
        msg: '[delete-workers] - worker',
        email: maskEmail(m.user.email),
        role: m.role,
      }),
    );
  }

  // Distinct identities behind those memberships. The soft delete is
  // identity-wide: it deactivates EVERY membership the person holds, in every
  // organization — not just the worker-role one found here. For a genuinely
  // multi-org user that also removes their other, non-worker access.
  const workerUserIds = [...new Set(orgs.flatMap((o) => o.organizationUsers).map((m) => m.userId))];
  logger.info({ msg: `[delete-workers] Identities to delete: ${workerUserIds.length}` });

  if (workerUserIds.length === 0) {
    logger.info({ msg: '[delete-workers] No workers found.' });
    return;
  }

  if (DRY_RUN) {
    logger.info({
      msg: '[delete-workers] [DRY RUN] Nothing was deleted. Re-run without --dry-run to execute.',
    });
    return;
  }

  let deleted = 0;
  for (const userId of workerUserIds) {
    const result = await softDeleteUser(userId, { actorRole: 'script:delete-workers' });
    if (result.status === 'deleted') deleted += 1;
    logger.info({ msg: '[delete-workers] Processed identity', userId, status: result.status });
  }

  logger.info({ msg: `[delete-workers] Done: ${deleted} identities soft-deleted` });
}

main()
  .catch((e) => {
    logger.error({ msg: '[delete-workers] Failed', err: e });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    rateLimiterRedis.disconnect();
  });
