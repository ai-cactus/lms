import { addDays } from './time';

/**
 * Deadline resolution for enrollments.
 *
 * The effective due date is the admin-set `dueAt` when provided, otherwise a
 * computed `start + N` days, where the window is taken (in priority order) from
 * the assignment, then the organization default, then the system default.
 */

/** System default due window when nothing else is configured. */
export const DEFAULT_DUE_WINDOW_DAYS = 30;

/**
 * Resolve the system default due window, honoring the optional
 * `REMINDER_DEFAULT_DUE_WINDOW_DAYS` env override. Parsed defensively (mirrors
 * the video-sweep worker's env parsing): a non-finite or non-positive value
 * falls back to {@link DEFAULT_DUE_WINDOW_DAYS}.
 */
export function resolveDefaultDueWindowDays(): number {
  const parsed = Number(process.env.REMINDER_DEFAULT_DUE_WINDOW_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DUE_WINDOW_DAYS;
}

/**
 * The date a deadline window counts from: the assignment's scheduled start, else
 * the enrollment's access date, else when the enrollment was created.
 */
export function resolveStartDate(
  assignment: { scheduleAt: Date | null },
  enrollment: { accessAt: Date | null; startedAt: Date },
): Date {
  return assignment.scheduleAt ?? enrollment.accessAt ?? enrollment.startedAt;
}

/**
 * Compute the effective deadline. An explicit `assignmentDueAt` always wins;
 * otherwise the window is `assignmentWindowDays ?? orgWindowDays ?? default`,
 * applied to `start`.
 */
export function computeDueAt(args: {
  assignmentDueAt: Date | null;
  assignmentWindowDays: number | null;
  orgWindowDays: number | null;
  start: Date;
}): Date {
  if (args.assignmentDueAt) return args.assignmentDueAt;
  const windowDays =
    args.assignmentWindowDays ?? args.orgWindowDays ?? resolveDefaultDueWindowDays();
  return addDays(args.start, windowDays);
}

/**
 * Parse a wizard time-of-day string into 24-hour components. Accepts the
 * canonical `"H:MM AM/PM"` value produced by the UI's TimePicker (and tolerates
 * loose input the same way): the digits form the hour/minute and an `a`/`p`
 * marker selects the meridiem. Returns `null` for empty or unparseable input.
 */
function parseTimeOfDay(value: string): { hours: number; minutes: number } | null {
  const str = value.trim().toLowerCase();
  if (!str) return null;

  const digits = str.replace(/\D/g, '');
  if (!digits) return null;

  let hours: number;
  let minutes = 0;
  if (digits.length <= 2) {
    hours = parseInt(digits, 10);
  } else if (digits.length === 3) {
    hours = parseInt(digits[0], 10);
    minutes = parseInt(digits.slice(1), 10);
  } else {
    hours = parseInt(digits.slice(0, 2), 10);
    minutes = parseInt(digits.slice(2, 4), 10);
  }

  if (hours > 23 || minutes > 59) return null;

  if (str.includes('p') && hours < 12) hours += 12;
  else if (str.includes('a') && hours === 12) hours = 0;

  return { hours, minutes };
}

/**
 * Combine the course wizard's separate date and time-of-day inputs into a single
 * absolute deadline. Returns `null` when no date is given (the caller then falls
 * back to a computed window). The date is interpreted in UTC — `dueDate` arrives
 * as a UTC-midnight `Date` (from `new Date("YYYY-MM-DD")`) — so a missing or
 * unparseable `dueTime` leaves the deadline at 00:00 UTC on that day.
 */
export function combineDateAndTime(
  dueDate: Date | null | undefined,
  dueTime: string | null | undefined,
): Date | null {
  if (!dueDate) return null;

  const result = new Date(dueDate);
  const time = dueTime ? parseTimeOfDay(dueTime) : null;
  if (time) {
    result.setUTCHours(time.hours, time.minutes, 0, 0);
  }
  return result;
}
