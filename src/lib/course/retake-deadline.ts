import { localDateKey, zonedWallClockToInstant } from '@/lib/reminders/time';

/**
 * The retake deadline (Q-26, ruled 2026-09-28): the admin picks it in the
 * assign-retake dialog, pre-filled this many days out. Without a deadline a
 * retake never entered the reminder ladder, so once one was assigned nothing
 * reminded the learner or escalated to a manager.
 *
 * Pure — no Prisma — so the client dialog and the Server Action share it.
 */
export const DEFAULT_RETAKE_DUE_DAYS = 14;

/**
 * The time of day a picked date is due: the assign-courses modal's 11:59 PM
 * default. Written as UTC fields only to carry the wall-clock time —
 * {@link zonedWallClockToInstant} reads it in the learner's facility zone
 * (BUG-12.3).
 */
const RETAKE_DUE_TIME = 'T23:59:00.000Z';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const UNREADABLE_DUE_DATE = "That due date couldn't be read. Please pick the date again.";

/**
 * The default due date as `YYYY-MM-DD` (the DatePicker's value format):
 * {@link DEFAULT_RETAKE_DUE_DAYS} after the learner's today in their facility
 * zone. The dialog pre-fills it and the server falls back to it, so the two
 * agree however far the admin is from the learner.
 */
export function defaultRetakeDueDate(now: Date, timeZone: string): string {
  const due = new Date(`${localDateKey(now, timeZone)}T00:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() + DEFAULT_RETAKE_DUE_DAYS);
  return due.toISOString().slice(0, 10);
}

export type RetakeDueDateResult = { dueDate: string } | { refusedReason: string };

/**
 * Check the dialog's `YYYY-MM-DD` is a real calendar date. The value arrives
 * through a Server Action, so its type is checked here too. Whether it has
 * already passed depends on the learner's zone, so that is
 * {@link retakeDueAtIfNotPast}'s call, once the learner is known.
 */
export function parseRetakeDueDate(value: unknown): RetakeDueDateResult {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    return { refusedReason: UNREADABLE_DUE_DATE };
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  // `new Date` rolls an impossible day (2026-02-31) into the next month rather
  // than failing, so a round trip is what proves the date was real.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { refusedReason: UNREADABLE_DUE_DATE };
  }
  return { dueDate: value };
}

/** A retake due 11:59 PM on `dueDate` (`YYYY-MM-DD`) in the learner's `timeZone`. */
export function retakeDueAt(dueDate: string, timeZone: string): Date {
  return zonedWallClockToInstant(new Date(`${dueDate}${RETAKE_DUE_TIME}`), timeZone);
}

export type RetakeDueAtResult = { dueAt: Date } | { refusedReason: string };

/**
 * The retake's `dueAt` for a validated `dueDate`, refused when that deadline has
 * already passed where the learner is — "today" stays pickable until 11:59 PM
 * in their facility zone.
 */
export function retakeDueAtIfNotPast(
  dueDate: string,
  timeZone: string,
  now: Date,
): RetakeDueAtResult {
  const dueAt = retakeDueAt(dueDate, timeZone);
  if (dueAt.getTime() < now.getTime()) {
    return { refusedReason: 'The retake due date must be today or later.' };
  }
  return { dueAt };
}

/** The deadline a retake gets when the caller supplied none: {@link defaultRetakeDueDate}. */
export function defaultRetakeDueAt(now: Date, timeZone: string): Date {
  return retakeDueAt(defaultRetakeDueDate(now, timeZone), timeZone);
}
