/*
 * sync-auditor-access.ts — reconciles `Organization.hasAuditorAccess` with each
 * org's subscription status, granting it to active/trialing orgs and revoking it
 * from the rest.
 *
 * Usage:
 *   npx tsx scripts/sync-auditor-access.ts --dry-run   # report only
 *   npx tsx scripts/sync-auditor-access.ts             # apply
 *
 * Flags:
 *   --dry-run   Report the organizations that would change, write nothing.
 */
import { prisma } from '@/db/index';
import { logger } from '@/lib/logger';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  logger.info({
    msg: `[sync-auditor-access] Starting auditor access synchronization...${DRY_RUN ? ' [DRY RUN]' : ''}`,
  });

  // 1. Find organizations that SHOULD have access but don't
  const toGrant = await prisma.organization.findMany({
    where: {
      hasAuditorAccess: false,
      subscription: {
        status: { in: ['active', 'trialing'] },
      },
    },
    select: { id: true, name: true },
  });

  logger.info({
    msg: `[sync-auditor-access] Found ${toGrant.length} organizations to grant access to.`,
  });

  for (const org of toGrant) {
    logger.info({
      msg: `[sync-auditor-access] ${DRY_RUN ? '[DRY RUN] Would grant' : 'Granting'} access to: ${org.name} (${org.id})`,
    });
    if (DRY_RUN) continue;
    await prisma.organization.update({
      where: { id: org.id },
      data: { hasAuditorAccess: true },
    });
  }

  // 2. Find organizations that SHOULD NOT have access but do (optional safety check)
  const toRevoke = await prisma.organization.findMany({
    where: {
      hasAuditorAccess: true,
      OR: [{ subscription: null }, { subscription: { status: { notIn: ['active', 'trialing'] } } }],
    },
    select: { id: true, name: true },
  });

  logger.info({
    msg: `[sync-auditor-access] Found ${toRevoke.length} organizations to revoke access from.`,
  });

  for (const org of toRevoke) {
    logger.info({
      msg: `[sync-auditor-access] ${DRY_RUN ? '[DRY RUN] Would revoke' : 'Revoking'} access from: ${org.name} (${org.id})`,
    });
    if (DRY_RUN) continue;
    await prisma.organization.update({
      where: { id: org.id },
      data: { hasAuditorAccess: false },
    });
  }

  logger.info({
    msg: DRY_RUN
      ? '[sync-auditor-access] Dry run complete — nothing was written.'
      : '[sync-auditor-access] Synchronization complete.',
  });

  if (toGrant.length === 0) {
    logger.info({ msg: '[sync-auditor-access] --- Debug Info: All Organizations ---' });
    const allOrgs = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        hasAuditorAccess: true,
        subscription: { select: { status: true } },
      },
    });
    logger.info({ msg: '[sync-auditor-access] Organizations', organizations: allOrgs });
    logger.info({ msg: '[sync-auditor-access] --------------------------------------' });
    logger.info({
      msg: '[sync-auditor-access] TIP: If you see "subscription": null, it means the Stripe webhook never successfully saved the subscription to your database.',
    });
  }
}

main()
  .catch((e) => {
    logger.error({ msg: '[sync-auditor-access] Failed', err: e });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
