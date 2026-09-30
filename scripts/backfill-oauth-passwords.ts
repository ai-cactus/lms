/*
 * backfill-oauth-passwords.ts — replaces the empty `password` of OAuth-created
 * users with a random bcrypt hash and stamps their authProvider, so a blank
 * credential can never be used to sign in.
 *
 * Usage:
 *   npx tsx scripts/backfill-oauth-passwords.ts --dry-run   # report only
 *   npx tsx scripts/backfill-oauth-passwords.ts             # apply
 *
 * Flags:
 *   --dry-run   Report the users that would be updated, write nothing.
 */
import { prisma } from '@/db/index';
import bcrypt from 'bcryptjs';
import { BCRYPT_COST } from '@/lib/bcrypt-config';
import nodeCrypto from 'crypto';
import { logger } from '@/lib/logger';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  logger.info({
    msg: `[backfill-oauth-passwords] Starting backfill for empty passwords...${DRY_RUN ? ' [DRY RUN]' : ''}`,
  });

  const usersWithEmptyPassword = await prisma.user.findMany({
    where: { password: '' },
    select: { id: true },
  });

  logger.info({
    msg: `[backfill-oauth-passwords] Found ${usersWithEmptyPassword.length} users with empty passwords.`,
  });

  if (DRY_RUN) {
    for (const user of usersWithEmptyPassword) {
      logger.info({ msg: `[backfill-oauth-passwords] [DRY RUN] Would update user ${user.id}` });
    }
    logger.info({ msg: '[backfill-oauth-passwords] [DRY RUN] Exiting without writing changes.' });
    return;
  }

  for (const user of usersWithEmptyPassword) {
    const randomPassword = await bcrypt.hash(
      nodeCrypto.randomUUID() + Date.now().toString(),
      BCRYPT_COST,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: randomPassword,
        authProvider: 'microsoft-entra-id', // Assuming empty passwords were from OAuth
      },
    });
    logger.info({ msg: `[backfill-oauth-passwords] Updated user ${user.id}` });
  }

  logger.info({ msg: '[backfill-oauth-passwords] Backfill complete.' });
}

main()
  .catch((e) => {
    logger.error({ msg: '[backfill-oauth-passwords] Failed', err: e });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
