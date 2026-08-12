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

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`Starting backfill for empty passwords...${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const usersWithEmptyPassword = await prisma.user.findMany({
    where: { password: '' },
    select: { id: true },
  });

  console.log(`Found ${usersWithEmptyPassword.length} users with empty passwords.`);

  if (DRY_RUN) {
    for (const user of usersWithEmptyPassword) {
      console.log(`[DRY RUN] Would update user ${user.id}`);
    }
    console.log('[DRY RUN] Exiting without writing changes.');
    return;
  }

  for (const user of usersWithEmptyPassword) {
    const randomPassword = await bcrypt.hash(nodeCrypto.randomUUID() + Date.now().toString(), BCRYPT_COST);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: randomPassword,
        authProvider: 'microsoft-entra-id', // Assuming empty passwords were from OAuth
      },
    });
    console.log(`Updated user ${user.id}`);
  }

  console.log('Backfill complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
