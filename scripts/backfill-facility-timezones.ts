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

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { deriveTimezoneFromState } from '@/lib/reminders/us-state-timezone';

/**
 * Minimal .env loader (no deps) — fills process.env WITHOUT overwriting any
 * variable already present in the real environment. Mirrors the loader in
 * scripts/delete-video-courses.ts so this script works standalone (the Prisma
 * client reads DATABASE_URL lazily at query time, so loading env before main()
 * runs is sufficient).
 */
function loadEnvFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

function loadEnv(): void {
  const explicit = process.argv.find((a) => a.startsWith('--env-file='));
  const candidates = [
    explicit ? explicit.slice('--env-file='.length) : null,
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
    '.env.staging',
  ].filter(Boolean) as string[];
  for (const c of candidates) loadEnvFile(path.resolve(process.cwd(), c));
}

loadEnv();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  logger.info({ msg: '[backfill-tz] Starting facility timezone backfill', dryRun: DRY_RUN });

  // Imported dynamically (after loadEnv) because db/index.ts reads
  // process.env.DATABASE_URL eagerly at module-init — a static import would
  // evaluate before loadEnv() runs and default the pg adapter to localhost:5432.
  const { default: prisma } = await import('@/lib/prisma');

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
