/*
 * backfill-roles.js — one-time, idempotent owner promotion for the RBAC rollout.
 *
 * Context: the `rbac_roles` migration maps every legacy `admin` to `supervisor`.
 * This script then promotes the FOUNDER of each organisation (the earliest
 * `supervisor` by created_at) to `owner`, so every org that had an admin ends up
 * with exactly one owner.
 *
 * Behaviour:
 *   - For each organisation that has at least one `supervisor`:
 *       * if an `owner` already exists  -> skip (idempotent).
 *       * otherwise promote the earliest `supervisor`
 *         (ORDER BY created_at ASC, id ASC LIMIT 1) to `owner`.
 *   - `supervisor` users with a NULL organisation are logged and left untouched
 *     (they have no org to own).
 *
 * Safe to re-run. Run AFTER the migration has been applied, never before.
 *
 * Usage:
 *   node scripts/backfill-roles.js            # apply changes
 *   node scripts/backfill-roles.js --dry-run  # report only, write nothing
 *
 * This is a standalone Node CJS migration script (not part of the app bundle and
 * not linted with src/), so it uses console output and @prisma/client directly.
 */
/* eslint-disable no-console */
const path = require('path');
// Load DATABASE_URL for a standalone node run (app/Next loads env itself).
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

// Prisma 7.8 (client engine) requires a driver adapter — mirror src/db/index.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const DRY_RUN = process.argv.includes('--dry-run');

// Inline email mask — this script cannot import the TS logger.
const mask = (e) => (e ? e.replace(/(.{2}).+(@.+)/, '$1***$2') : 'unknown');

async function main() {
  console.log(`[backfill-roles] Starting${DRY_RUN ? ' (DRY RUN — no writes)' : ''}...`);

  const counters = {
    orgsWithSuperAdmin: 0,
    orgsAlreadyOwned: 0,
    promoted: 0,
    orgsWithNoSuperAdmin: 0,
    orphanSuperAdmins: 0,
  };

  // Orphan supervisors (no organisation) — cannot own an org, leave as-is.
  const orphans = await prisma.user.findMany({
    where: { role: 'supervisor', organizationId: null },
    select: { id: true, email: true },
  });
  counters.orphanSuperAdmins = orphans.length;
  for (const u of orphans) {
    console.log(
      `[backfill-roles] Orphan supervisor (no org) left unchanged: ${u.id} <${mask(u.email)}>`,
    );
  }

  // Distinct org IDs that have at least one supervisor.
  const orgRows = await prisma.user.findMany({
    where: { role: 'supervisor', organizationId: { not: null } },
    distinct: ['organizationId'],
    select: { organizationId: true },
  });
  const orgIds = orgRows.map((r) => r.organizationId).filter(Boolean);
  counters.orgsWithSuperAdmin = orgIds.length;

  for (const organizationId of orgIds) {
    // Idempotency: skip if this org already has an owner.
    const existingOwner = await prisma.user.findFirst({
      where: { organizationId, role: 'owner' },
      select: { id: true },
    });
    if (existingOwner) {
      counters.orgsAlreadyOwned += 1;
      console.log(`[backfill-roles] Org ${organizationId} already has an owner — skipping.`);
      continue;
    }

    // Earliest supervisor becomes the owner.
    const founder = await prisma.user.findFirst({
      where: { organizationId, role: 'supervisor' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, email: true },
    });

    if (!founder) {
      // Should not happen given the query above, but guard anyway.
      counters.orgsWithNoSuperAdmin += 1;
      console.log(`[backfill-roles] Org ${organizationId} has no supervisor — skipping.`);
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[backfill-roles] Would promote ${founder.id} <${mask(founder.email)}> to owner for org ${organizationId}.`,
      );
    } else {
      await prisma.user.update({ where: { id: founder.id }, data: { role: 'owner' } });
      console.log(
        `[backfill-roles] Promoted ${founder.id} <${mask(founder.email)}> to owner for org ${organizationId}.`,
      );
    }
    counters.promoted += 1;
  }

  console.log('[backfill-roles] Summary:', JSON.stringify(counters));
  console.log(`[backfill-roles] Done${DRY_RUN ? ' (DRY RUN)' : ''}.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[backfill-roles] Failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
