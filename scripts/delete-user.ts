/*
 * delete-user.ts — soft-deletes one identity through the same shared
 * `softDeleteUser` the /system console uses (Q-23, RISK-14): every membership
 * is deactivated and sign-in is refused everywhere, while the person's
 * enrollments, quiz attempts, certificates and authored content are retained.
 * Nothing is hard-deleted, and the email is not freed for re-registration.
 *
 * Usage:
 *   npx tsx scripts/delete-user.ts --email someone@example.com --dry-run   # report only
 *   npx tsx scripts/delete-user.ts --email someone@example.com             # delete
 *
 * Flags:
 *   --email     The identity to delete (required).
 *   --dry-run   Report what would change, write nothing.
 */
import { prisma } from '@/db/index';
import { logger, maskEmail } from '@/lib/logger';
import { rateLimiterRedis } from '@/lib/rate-limit';
import { softDeleteUser } from '@/lib/system/delete-user';

const DRY_RUN = process.argv.includes('--dry-run');

function readEmailArg(): string | null {
  const index = process.argv.indexOf('--email');
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith('--') ? value.trim() : null;
}

async function main() {
  const email = readEmailArg();
  if (!email) {
    logger.error({ msg: '[delete-user] Missing --email <address>' });
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });
  if (!user) {
    logger.info({ msg: '[delete-user] User not found', email: maskEmail(email) });
    return;
  }
  if (user.deletedAt) {
    logger.info({
      msg: '[delete-user] User already deleted',
      userId: user.id,
      deletedAt: user.deletedAt.toISOString(),
    });
    return;
  }

  if (DRY_RUN) {
    const activeMemberships = await prisma.organizationUser.count({
      where: { userId: user.id, active: true },
    });
    logger.info({
      msg: '[delete-user] [DRY RUN] Would soft-delete user — nothing written',
      userId: user.id,
      activeMemberships,
    });
    return;
  }

  const result = await softDeleteUser(user.id, { actorRole: 'script:delete-user' });
  if (result.status === 'blocked') {
    // Q-30: nothing was changed. Same refusal the /system console shows.
    logger.error({ msg: `[delete-user] Refused: ${result.message}`, userId: user.id });
    process.exitCode = 1;
    return;
  }
  logger.info({ msg: '[delete-user] Done', userId: user.id, result });
}

main()
  .catch((e) => {
    logger.error({ msg: '[delete-user] Failed', err: e });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    rateLimiterRedis.disconnect();
  });
