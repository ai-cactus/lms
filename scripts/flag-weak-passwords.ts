/**
 * Flag Weak Passwords Migration Script
 *
 * Purpose: After introducing the strong password policy (12-char minimum with complexity
 * requirements), existing credential-based users may have passwords that don't meet the
 * new policy. Since bcrypt hashes are one-way, we cannot verify the original password
 * length — so we conservatively flag ALL credentials users for a forced password reset
 * on their next login.
 *
 * This script adds a `passwordResetRequired` flag to those users.
 *
 * Prerequisites:
 *   - Add `passwordResetRequired Boolean @default(false)` to the User model in schema.prisma
 *   - Run `npx prisma db push` or create a migration
 *
 * Usage:
 *   npx tsx scripts/flag-weak-passwords.ts [--dry-run]
 *
 * Flags:
 *   --dry-run   Print affected users without writing changes
 */

import { prisma } from '@/db/index';
import { logger } from '@/lib/logger';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  logger.info({ msg: '[flag-weak-passwords] === Flag Weak Passwords Migration ===' });
  if (DRY_RUN) {
    logger.info({ msg: '[flag-weak-passwords] [DRY RUN] No changes will be written.' });
  }

  // Find all credential-based users.
  // We cannot verify bcrypt hash length — all credentials users are flagged
  // unless they have already set a new password (updatedAt >= policy enforcement date).
  // Adjust POLICY_ENFORCED_AT to the date this new policy was deployed.
  const POLICY_ENFORCED_AT = new Date('2026-04-21T00:00:00.000Z');

  const affectedUsers = await prisma.user.findMany({
    where: {
      authProvider: 'credentials',
      // Only flag users who haven't updated their password since the new policy
      updatedAt: { lt: POLICY_ENFORCED_AT },
    },
    select: {
      id: true,
      email: true,
      updatedAt: true,
    },
  });

  if (affectedUsers.length === 0) {
    logger.info({
      msg: '[flag-weak-passwords] No users require password reset — all passwords are up to date.',
    });
    return;
  }

  logger.info({
    msg: `[flag-weak-passwords] Found ${affectedUsers.length} user(s) to flag for password reset`,
  });
  for (const user of affectedUsers) {
    logger.info({
      msg: `[flag-weak-passwords] - ${user.email} (last updated: ${user.updatedAt.toISOString()})`,
    });
  }

  if (DRY_RUN) {
    logger.info({ msg: '[flag-weak-passwords] [DRY RUN] Exiting without writing changes.' });
    return;
  }

  // NOTE: The `passwordResetRequired` field must exist on the User model.
  // Run `npx prisma migrate dev --name add_password_reset_required` after adding it to schema.
  //
  // Uncomment the block below once the schema migration has been applied:
  //
  // const { count } = await prisma.user.updateMany({
  //   where: {
  //     authProvider: 'credentials',
  //     updatedAt: { lt: POLICY_ENFORCED_AT },
  //   },
  //   data: { passwordResetRequired: true },
  // });
  // logger.info({ msg: `[flag-weak-passwords] ✓ Flagged ${count} user(s) for forced password reset` });

  logger.info({ msg: '[flag-weak-passwords] ⚠️  Action required' });
  logger.info({
    msg: '[flag-weak-passwords] 1. Add `passwordResetRequired Boolean @default(false)` to the User model',
  });
  logger.info({
    msg: '[flag-weak-passwords] 2. Run `npx prisma migrate dev --name add_password_reset_required`',
  });
  logger.info({
    msg: '[flag-weak-passwords] 3. Re-run this script to apply the flags (without --dry-run)',
  });
  logger.info({
    msg: '[flag-weak-passwords] 4. Update the authorize() callback in create-auth-instance.ts to check this flag',
  });
  logger.info({
    msg: '[flag-weak-passwords] and redirect to /reset-password if set, clearing the flag after a successful reset.',
  });
}

main()
  .catch((err) => {
    logger.error({ msg: '[flag-weak-passwords] Script failed', err });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
