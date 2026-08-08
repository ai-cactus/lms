/**
 * Cleanup Orphaned Organizations
 *
 * Purpose: the multi-org membership migration
 * (prisma/migrations/20260803120000_multi_org_membership) deliberately left
 * `organizations` rows (and their `facilities`) in place even where no
 * `organization_users` row was carried over. Those orgs have no members, no way
 * to be reached, and — because organization names are unique-by-name at
 * onboarding — they block their former owner from re-onboarding under the same
 * legal name ("Organization with this name already exists").
 *
 * This script finds every organization with zero membership rows and deletes it.
 * Facilities, invites and the rest of the org-owned graph go with it via the
 * schema's ON DELETE CASCADE.
 *
 * ⚠  The deletion is IRREVERSIBLE. Preview it with `--dry-run` first, and
 * double-check which DATABASE_URL you are pointed at.
 *
 * Usage:
 *   npx tsx scripts/cleanup-orphaned-orgs.ts --dry-run   # report only
 *   npx tsx scripts/cleanup-orphaned-orgs.ts             # delete
 *
 * Flags:
 *   --dry-run   Report the organizations that would be deleted, write nothing.
 *
 * NOTE: this script must stay runnable inside the deployed app container
 * (`npm run script <env> cleanup-orphaned-orgs.ts`), whose image carries `db/`
 * but NOT `src/` — so only `@/db/*` imports are allowed here and output goes
 * through console like the other container-run scripts (sync-auditor-access).
 */
import { prisma } from '@/db/index';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`Scanning for organizations with no members...${DRY_RUN ? ' [DRY RUN]' : ''}`);

  // "Orphaned" means NO membership row at all — not merely no ACTIVE one. An org
  // whose members were all deactivated still has an owner who can be restored,
  // and must never be deleted here.
  const orphans = await prisma.organization.findMany({
    where: { organizationUsers: { none: {} } },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { facilities: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const org of orphans) {
    console.log(
      `  - ${org.id}  "${org.name}"  facilities=${org._count.facilities}  created=${org.createdAt.toISOString()}`,
    );
  }

  console.log(`Orphaned organizations found: ${orphans.length}`);

  if (orphans.length === 0) return;

  if (DRY_RUN) {
    console.log('Dry run — nothing deleted. Re-run without --dry-run to delete.');
    return;
  }

  const deleted = await prisma.organization.deleteMany({
    where: { id: { in: orphans.map((org) => org.id) } },
  });

  console.log(`Orphaned organizations deleted: ${deleted.count}`);
}

main()
  .catch((e) => {
    console.error('Cleanup failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
