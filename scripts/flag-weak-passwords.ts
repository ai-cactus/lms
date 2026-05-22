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

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('=== Flag Weak Passwords Migration ===');
  if (DRY_RUN) {
    console.log('[DRY RUN] No changes will be written.\n');
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
    console.log('No users require password reset — all passwords are up to date.');
    return;
  }

  console.log(`Found ${affectedUsers.length} user(s) to flag for password reset:\n`);
  for (const user of affectedUsers) {
    console.log(`  - ${user.email} (last updated: ${user.updatedAt.toISOString()})`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Exiting without writing changes.');
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
  // console.log(`\n✓ Flagged ${count} user(s) for forced password reset on next login.`);

  console.log('\n⚠️  Action required:');
  console.log('   1. Add `passwordResetRequired Boolean @default(false)` to the User model');
  console.log('   2. Run `npx prisma migrate dev --name add_password_reset_required`');
  console.log('   3. Re-run this script to apply the flags (without --dry-run)');
  console.log(
    '   4. Update the authorize() callback in create-auth-instance.ts to check this flag',
  );
  console.log(
    '      and redirect to /reset-password if set, clearing the flag after a successful reset.',
  );
}

main()
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
