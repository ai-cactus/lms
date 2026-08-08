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

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`Starting auditor access synchronization...${DRY_RUN ? ' [DRY RUN]' : ''}`);

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

  console.log(`Found ${toGrant.length} organizations to grant access to.`);

  for (const org of toGrant) {
    console.log(
      `${DRY_RUN ? '[DRY RUN] Would grant' : 'Granting'} access to: ${org.name} (${org.id})`,
    );
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

  console.log(`Found ${toRevoke.length} organizations to revoke access from.`);

  for (const org of toRevoke) {
    console.log(
      `${DRY_RUN ? '[DRY RUN] Would revoke' : 'Revoking'} access from: ${org.name} (${org.id})`,
    );
    if (DRY_RUN) continue;
    await prisma.organization.update({
      where: { id: org.id },
      data: { hasAuditorAccess: false },
    });
  }

  console.log(DRY_RUN ? 'Dry run complete — nothing was written.' : 'Synchronization complete.');

  if (toGrant.length === 0) {
    console.log('\n--- Debug Info: All Organizations ---');
    const allOrgs = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        hasAuditorAccess: true,
        subscription: { select: { status: true } },
      },
    });
    console.log(JSON.stringify(allOrgs, null, 2));
    console.log('--------------------------------------');
    console.log(
      'TIP: If you see "subscription": null, it means the Stripe webhook never successfully saved the subscription to your database.',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
