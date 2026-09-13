import { REMINDER_STAGE_DEFAULTS } from '@/lib/reminders/stages';
import type { ReminderStage } from '@/generated/prisma/enums';

/**
 * The "remind N days before the deadline" vocabulary every assign surface
 * speaks, and its translation to and from the `AssignmentReminderStage` ladder.
 *
 * Split out of `./assignment` so the shared `ReminderLadderInput` control can
 * import it: that module opens a Prisma client at import time, which must never
 * reach a client bundle. Same split as `@/lib/facility/org-wide-roles` against
 * `@/lib/facility/scope` — the pure half is re-exported from the server half so
 * existing import sites keep working.
 */

/**
 * Ladder stages the "N days before" reminder rows map onto, in the order a row
 * list is consumed (furthest-out row first). Only the worker-audience
 * pre-deadline stages are listed: the grace/overdue stages notify the escalation
 * manager AFTER the deadline, so they are never driven by these rows and always
 * keep their canonical defaults.
 */
export const WIZARD_REMINDER_STAGES: ReminderStage[] = [
  'FRIENDLY_REMINDER',
  'URGENT_REMINDER',
  'DAY_OF_DEADLINE',
];

/** How many wizard reminder rows the ladder can represent. */
export const MAX_WIZARD_REMINDER_ROWS = WIZARD_REMINDER_STAGES.length;

/**
 * A stored stage offset read back as whole days before the deadline. The `0`
 * guard keeps a day-of-deadline row at `0` rather than `-0`, mirroring the
 * outbound mapping.
 */
function daysBeforeFromOffset(offsetDays: number): number {
  return offsetDays === 0 ? 0 : -offsetDays;
}

/**
 * The cadence a brand-new assignment starts from, in the row vocabulary: the
 * canonical defaults of the stages these rows own. A surface that renders the
 * ladder for a course with no assignment yet must prefill this, or submitting
 * an untouched form would read as "the admin cleared every reminder".
 */
export const DEFAULT_WIZARD_REMINDER_DAYS: number[] = WIZARD_REMINDER_STAGES.map((stage) =>
  daysBeforeFromOffset(REMINDER_STAGE_DEFAULTS[stage].offsetDays),
);

/**
 * Read a stored ladder back into "N days before" rows — the inverse of
 * `reminderDaysToStageRows`, for a surface prefilling its editor from the saved
 * assignment.
 *
 * Only enabled rows of the stages this vocabulary owns can be represented: a
 * disabled stage is an absent row, and a positive offset (a post-deadline
 * escalation stage, or a per-stage override written through the programmatic
 * hatch) has no expression here and is dropped rather than shown as a negative
 * "days before". Sorted furthest-out first so the rows come back in the order
 * they are mapped out again.
 */
export function stageRowsToReminderDays(
  rows: { stage: ReminderStage; offsetDays: number; enabled: boolean }[],
): number[] {
  return rows
    .filter((row) => row.enabled && WIZARD_REMINDER_STAGES.includes(row.stage))
    .map((row) => daysBeforeFromOffset(row.offsetDays))
    .filter((days) => days >= 0)
    .sort((a, b) => b - a)
    .slice(0, MAX_WIZARD_REMINDER_ROWS);
}
