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
