/**
 * Timezone-aware "day" math for the reminder engine.
 *
 * The sweep runs daily and the CSV cadence is day-granular, so every comparison
 * must agree on what "today" means for a given organization. We do this with the
 * platform-native `Intl.DateTimeFormat` (no extra dependency): it knows the IANA
 * tz database, including DST, so we never hand-roll offset tables.
 *
 * All functions are pure and unit-testable: explicit `Date` + `tz` inputs →
 * explicit outputs, no hidden clock reads.
 */

/** Fallback IANA zone when an organization has no timezone set. */
export const DEFAULT_TZ = 'America/New_York';

/**
 * Validate an IANA tz name, returning {@link DEFAULT_TZ} when it is unknown.
 * `Intl.DateTimeFormat` throws `RangeError` for an invalid `timeZone`.
 */
function resolveTz(tz: string): string {
  try {
    // Constructing a formatter is the cheapest way to validate the zone.
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/**
 * The local calendar date of `date` in `tz`, as `YYYY-MM-DD`.
 *
 * We use the `en-CA` locale because it natively formats dates as `YYYY-MM-DD`,
 * which is exactly the key shape we want for set membership and comparison.
 */
export function localDateKey(date: Date, tz: string): string {
  const safeTz = resolveTz(tz);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The wall-clock offset (ms) between `tz` and UTC at the given instant, i.e.
 * `localWallTime - utc`. Derived by rendering the instant in `tz`, reinterpreting
 * those wall-clock parts as if they were UTC, and subtracting the real instant.
 * `Intl` handles DST, so the offset is correct for the specific instant.
 */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const lookup = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    lookup('year'),
    lookup('month') - 1,
    lookup('day'),
    lookup('hour'),
    lookup('minute'),
    lookup('second'),
  );
  return asUtc - date.getTime();
}

/**
 * The UTC instant corresponding to 00:00 local time in `tz` on the same calendar
 * day as `date`.
 *
 * Approach: take the local calendar date, build a UTC guess for "that date at
 * midnight", then subtract the zone's offset at that guess. One correction
 * suffices in practice — US DST transitions occur at 02:00 local, never at
 * midnight, so the offset measured at the guess matches the offset at the result.
 */
export function startOfDayInTz(date: Date, tz: string): Date {
  const safeTz = resolveTz(tz);
  const [year, month, day] = localDateKey(date, safeTz).split('-').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = tzOffsetMs(new Date(utcGuess), safeTz);
  return new Date(utcGuess - offset);
}

/**
 * Add `days` calendar days to `date`, operating on UTC fields so the arithmetic
 * is unaffected by the host machine's local timezone. Used together with
 * {@link startOfDayInTz} to project a stage's target date from a deadline.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Whole-day difference between the local calendar dates of `a` and `b` in `tz`
 * (`a - b`, in days). Both instants are normalized to local midnight first, then
 * the span is rounded to whole days so a DST hour shift never produces a
 * fractional result. Used for "days overdue" math.
 */
export function diffInDaysInTz(a: Date, b: Date, tz: string): number {
  const safeTz = resolveTz(tz);
  const startA = startOfDayInTz(a, safeTz).getTime();
  const startB = startOfDayInTz(b, safeTz).getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((startA - startB) / MS_PER_DAY);
}
