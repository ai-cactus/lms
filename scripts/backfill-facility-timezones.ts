/**
 * Backfill Facility Timezones
 *
 * Purpose: the Reminders & Escalations work introduced a nullable `timezone`
 * column (IANA name, e.g. `America/New_York`). With the Organization → Facility
 * split, location and timezone fields live on `Facility`: new facilities get a
 * timezone derived from their US state at creation, but facilities that existed
 * before this change (or were seeded by the split migration from an org that had
 * no timezone) have `timezone = NULL`. The reminder sweep does day-granular math
 * per facility and needs a zone, so this one-off backfill sets
 * `timezone = deriveTimezoneFromState(state)` for every facility still NULL.
 *
 * `deriveTimezoneFromState` falls back to `DEFAULT_TZ` (America/New_York) for an
 * empty/unknown state, so every backfilled facility ends up with a usable zone.
 *
 * Prerequisites:
 *   - The `add_facility` migration (moves `timezone`/`state` onto `Facility`)
 *     has been applied and the Prisma client regenerated.
 *
 * Usage:
 *   npx tsx scripts/backfill-facility-timezones.ts [--dry-run]
 *
 * Flags:
 *   --dry-run   Log the facilities that would be updated without writing changes.
 */
import { logger } from '@/lib/logger';
import { prisma } from '@/db/index';
import { deriveTimezoneFromState } from '@/lib/reminders/us-state-timezone';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  logger.info({ msg: '[backfill-tz] Starting facility timezone backfill', dryRun: DRY_RUN });

  const facilitiesToBackfill = await prisma.facility.findMany({
    where: { timezone: null },
    select: { id: true, state: true },
  });

  logger.info({
    msg: '[backfill-tz] Facilities needing a timezone',
    count: facilitiesToBackfill.length,
  });

  let updated = 0;
  for (const facility of facilitiesToBackfill) {
    const timezone = deriveTimezoneFromState(facility.state);

    if (DRY_RUN) {
      logger.info({
        msg: '[backfill-tz] Would update facility timezone',
        facilityId: facility.id,
        state: facility.state,
        timezone,
      });
      continue;
    }

    await prisma.facility.update({
      where: { id: facility.id },
      data: { timezone },
    });
    updated += 1;
    logger.info({
      msg: '[backfill-tz] Facility timezone set',
      facilityId: facility.id,
      state: facility.state,
      timezone,
    });
  }

  logger.info({
    msg: '[backfill-tz] Backfill complete',
    dryRun: DRY_RUN,
    candidates: facilitiesToBackfill.length,
    updated,
  });

  // prisma is imported dynamically inside main(); disconnect here while in scope.
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    logger.error({ msg: '[backfill-tz] Backfill failed', err: e });
    process.exit(1);
  });
