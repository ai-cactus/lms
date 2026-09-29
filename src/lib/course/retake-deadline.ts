import { combineDateAndTime } from '@/lib/reminders/deadline';

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
 * The time of day a picked date is due, matching the assign-courses modal's
 * default. Deadlines are UTC wall-clock across the product (BUG-12), and the
 * end of the day keeps a picked date from landing on the previous evening in a
 * US timezone.
 */
const RETAKE_DUE_TIME = '11:59 PM';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` for `date` in the viewer's own calendar — the DatePicker's value format. */
function toLocalDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The dialog's pre-filled due date: {@link DEFAULT_RETAKE_DUE_DAYS} after `today`. */
export function defaultRetakeDueDate(today: Date): string {
  const due = new Date(today);
  due.setDate(due.getDate() + DEFAULT_RETAKE_DUE_DAYS);
  return toLocalDateInput(due);
}

export type RetakeDueAtResult = { dueAt: Date } | { refusedReason: string };

/**
 * Turn the dialog's `YYYY-MM-DD` into the retake's `dueAt`, refusing anything
 * that is not a real calendar date or whose deadline has already passed. The
 * value arrives through a Server Action, so its type is checked here too.
 */
export function parseRetakeDueDate(value: unknown, now: Date): RetakeDueAtResult {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    return { refusedReason: "That due date couldn't be read. Please pick the date again." };
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  // `new Date` rolls an impossible day (2026-02-31) into the next month rather
  // than failing, so a round trip is what proves the date was real.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { refusedReason: "That due date couldn't be read. Please pick the date again." };
  }
  const dueAt = combineDateAndTime(date, RETAKE_DUE_TIME);
  if (!dueAt || dueAt.getTime() < now.getTime()) {
    return { refusedReason: 'The retake due date must be today or later.' };
  }
  return { dueAt };
}

/** The deadline a retake gets when the caller supplied none. */
export function defaultRetakeDueAt(now: Date): Date {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + DEFAULT_RETAKE_DUE_DAYS);
  return combineDateAndTime(date, RETAKE_DUE_TIME) ?? date;
}
