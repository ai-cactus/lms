import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { REMINDER_STAGE_DEFAULTS, SWEEP_STAGES } from '@/lib/reminders/stages';
import { MAX_WIZARD_REMINDER_ROWS, WIZARD_REMINDER_STAGES } from './reminder-ladder';
import { assignmentFacilityScopeColumns } from './assignment-facility-scope';
import type { RenewalCycle, ReminderStage, UserRole } from '@/generated/prisma/enums';

// Re-exported so the ladder vocabulary stays importable from this module.
export { MAX_WIZARD_REMINDER_ROWS, WIZARD_REMINDER_STAGES } from './reminder-ladder';

/**
 * Shared {@link CourseAssignment} persistence, extracted from the enrollment
 * action so every assignment entry point — individual enrollment, role targeting
 * and the courses-list assign modal — writes the same schedule / deadline /
 * reminder shape instead of each rolling its own.
 */

export interface StageRowInput {
  stage: ReminderStage;
  offsetDays: number;
  enabled: boolean;
  channels: string[];
}

/**
 * Default `AssignmentReminderStage` rows — one per sweep stage seeded from the
 * canonical {@link REMINDER_STAGE_DEFAULTS}. Used when the caller does not supply
 * its own cadence. `INITIAL_LAUNCH` is intentionally excluded (it fires at
 * assignment time, never via the daily sweep).
 */
export function defaultStageRows(): StageRowInput[] {
  return SWEEP_STAGES.map((stage) => {
    const def = REMINDER_STAGE_DEFAULTS[stage];
    return { stage, offsetDays: def.offsetDays, enabled: true, channels: def.channels };
  });
}

/**
 * Translate the wizard's whole-day "remind N days before the deadline" rows into
 * `AssignmentReminderStage` rows.
 *
 * The ladder is a fixed stage enum, not a free list, so the rows are sorted
 * furthest-out first and mapped onto {@link WIZARD_REMINDER_STAGES} in order
 * (`offsetDays` is signed and relative to `dueAt`, so "7 days before" is `-7`).
 * A stage with no matching row is disabled rather than left at its default, so
 * the admin's ladder is exactly what they configured. Rows beyond the ladder's
 * capacity are dropped — the wizard caps the row count to match.
 *
 * Only the wizard's own stages are emitted. The escalation stages are outside
 * this vocabulary, and the sink upserts every row handed to it, so emitting
 * them at their canonical default would silently reset an org's customised
 * grace/overdue offsets on each wizard-vocabulary save. Omitting them is safe
 * on the create path too: the sweep falls back to `REMINDER_STAGE_DEFAULTS`
 * for any stage with no config row (`runTrackA` in `@/lib/reminders/sweep`).
 */
export function reminderDaysToStageRows(daysBefore: number[]): StageRowInput[] {
  const offsets = [
    ...new Set(
      daysBefore
        .filter((days) => Number.isFinite(days) && days >= 0)
        .map((days) => Math.trunc(days)),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, MAX_WIZARD_REMINDER_ROWS);

  return WIZARD_REMINDER_STAGES.map((stage, position) => {
    const def = REMINDER_STAGE_DEFAULTS[stage];
    const days = offsets[position];
    if (days === undefined) {
      return { stage, offsetDays: def.offsetDays, enabled: false, channels: def.channels };
    }
    // `days === 0` is the day of the deadline; negating it would store -0.
    return { stage, offsetDays: days === 0 ? 0 : -days, enabled: true, channels: def.channels };
  });
}

/** A caller-supplied cadence row, before the channel default is applied. */
export interface StageRowOverrideInput {
  stage: ReminderStage;
  offsetDays: number;
  enabled: boolean;
  channels?: string[];
}

/**
 * Pick the stage rows an assignment should be written with, from whichever
 * vocabulary the caller speaks: explicit per-stage rows win over the wizard's
 * coarser "N days before" list. Shared so every assign surface resolves the
 * ladder identically.
 *
 * A caller that expressed no cadence at all gets `undefined` — the ladder lives
 * on the organisation-wide row, so a surface with no reminder controls (the
 * staff-profile modal) must leave it exactly as another surface configured it.
 * {@link upsertCourseAssignment} still seeds the canonical defaults when it is
 * creating the row.
 */
export function resolveStageRows(input: {
  stages?: StageRowOverrideInput[];
  reminderDaysBefore?: number[];
}): StageRowInput[] | undefined {
  if (input.stages?.length) {
    return input.stages.map((row) => ({
      stage: row.stage,
      offsetDays: row.offsetDays,
      enabled: row.enabled,
      channels: row.channels ?? ['email', 'in_app'],
    }));
  }
  if (input.reminderDaysBefore) return reminderDaysToStageRows(input.reminderDaysBefore);
  return undefined;
}

export interface UpsertCourseAssignmentParams {
  organizationId: string;
  courseId: string;
  assignedByAdminId: string;
  /**
   * Date the course becomes available. `undefined` leaves an existing row's
   * value untouched (and takes the column default on create); `null` clears it.
   *
   * The same tri-state applies to {@link dueAt}, {@link dueWindowDays},
   * {@link remindersEnabled} and {@link renewalCycle}: the row is shared by the
   * whole organisation, so a surface that has no opinion on a setting must omit
   * it rather than restate a default over everyone already enrolled.
   */
  scheduleAt?: Date | null;
  /**
   * Absolute deadline for every enrollee. `undefined` leaves it alone; `null`
   * clears it.
   *
   * A surface whose deadline control is per-person rather than per-course must
   * omit it — that is what `EnrollUsersOptions.deadlineScope: 'enrollment'`
   * does, so the picked date reaches only the enrollments it created.
   */
  dueAt?: Date | null;
  /** Deadline window in days, used when there is no {@link dueAt}. `undefined` leaves it alone. */
  dueWindowDays?: number | null;
  /** Master switch for the reminder ladder. `undefined` leaves it alone. */
  remindersEnabled?: boolean;
  /** Recurring re-assignment cadence. `undefined` leaves it alone. */
  renewalCycle?: RenewalCycle;
  /**
   * The reminder ladder to write. `undefined` leaves an existing row's ladder
   * untouched and seeds {@link defaultStageRows} on a new row — the same
   * tri-state as the settings columns, for the same reason.
   */
  stageRows?: StageRowInput[];
  /**
   * Roles this assignment targets. `undefined` leaves the existing value untouched
   * (an individual re-assignment must never clear a course's role targeting);
   * `null` / `[]` explicitly clears it; a non-empty list sets it.
   */
  targetRoles?: UserRole[] | null;
  /**
   * The facility scope the assignment is created under, in
   * `resolveDataFacilityIds`' vocabulary. `undefined` leaves an existing row's
   * scope untouched (an individual re-assignment must not restate the role
   * targeting's reach); `null` records org-wide; an array narrows to exactly
   * those facilities, and an empty array to nobody.
   *
   * Note this null differs from `targetRoles`' — there `null` clears, here it is
   * the org-wide value. See {@link assignmentFacilityScopeColumns}.
   */
  facilityScope?: string[] | null;
}

/**
 * The two role-target columns written together, so a row is never internally
 * inconsistent: `targetRoles` is the authoritative list, and the superseded
 * single-value `targetRole` keeps carrying the FIRST role for the readers that
 * still use it (the nightly reminder sweep's role-target reconcile pre-pass and
 * the assign page's mode detection).
 *
 * Exported because {@link setRoleAssignmentTargets} writes the same pair outside
 * this upsert: a desync would leave the sweep's `targetRole: { not: null }`
 * pre-pass matching rows whose authoritative list is empty (or missing rows whose
 * list is not), so the two columns must only ever be produced from one place.
 */
export function roleTargetColumns(targetRoles: UserRole[] | null | undefined) {
  if (targetRoles === undefined) return {};
  if (targetRoles === null || targetRoles.length === 0) {
    return { targetRole: null, targetRoles: [] };
  }
  return { targetRole: targetRoles[0], targetRoles };
}

/** As {@link roleTargetColumns}, for the recorded facility scope. */
function facilityScopeColumns(facilityScope: string[] | null | undefined) {
  if (facilityScope === undefined) return {};
  return assignmentFacilityScopeColumns(facilityScope);
}

/**
 * As {@link roleTargetColumns}, for the schedule / deadline / reminder settings
 * the row carries. A field the caller omitted is left out of the write
 * entirely, so an existing row keeps its value and a new row takes the column
 * default — one assign surface's silence must never clear a setting another
 * surface configured for the whole organisation.
 *
 * `null` stays a real value here (it clears the column); only `undefined` means
 * "leave alone". Do not normalise either way — see
 * {@link UpsertCourseAssignmentParams.facilityScope}, whose `null` carries the
 * opposite meaning again.
 */
function settingsColumns(params: UpsertCourseAssignmentParams) {
  const { scheduleAt, dueAt, dueWindowDays, remindersEnabled, renewalCycle } = params;
  return {
    ...(scheduleAt !== undefined ? { scheduleAt } : {}),
    ...(dueAt !== undefined ? { dueAt } : {}),
    ...(dueWindowDays !== undefined ? { dueWindowDays } : {}),
    ...(remindersEnabled !== undefined ? { remindersEnabled } : {}),
    ...(renewalCycle !== undefined ? { renewalCycle } : {}),
  };
}

/**
 * The deadline currently stored on the org's assignment for a course — `null`
 * when there is no assignment yet, or it carries no absolute deadline.
 *
 * Read by the assign actions before they write: a submitted deadline in the
 * past is only refused when it DIFFERS from this, so a late joiner can still be
 * added to an already-overdue course without moving the deadline for everyone.
 */
export async function findAssignmentDueAt(
  organizationId: string,
  courseId: string,
): Promise<Date | null> {
  const existing = await prisma.courseAssignment.findFirst({
    where: { organizationId, courseId },
    orderBy: { createdAt: 'desc' },
    select: { dueAt: true },
  });
  return existing?.dueAt ?? null;
}

/**
 * Create or update the org's single {@link CourseAssignment} for a course and
 * reconcile its per-stage reminder cadence. One assignment per
 * `(organizationId, courseId)`: reuse the most recent row so already-enrolled
 * workers keep firing off the same (now updated) schedule/ladder. Stage rows are
 * upserted on the `(assignmentId, stage)` unique key — never duplicated — and
 * stages outside the submitted set survive.
 *
 * Returns the row's RESOLVED deadline state alongside its id, not the caller's
 * input: a caller that omitted `dueWindowDays` must build its per-enrollee
 * deadline from what the row actually holds, or the individual it is enrolling
 * lands on the system default window while everyone else on the same assignment
 * keeps the configured one.
 */
export async function upsertCourseAssignment(
  params: UpsertCourseAssignmentParams,
): Promise<{ id: string; dueAt: Date | null; dueWindowDays: number | null }> {
  const { organizationId, courseId, targetRoles } = params;
  const roleColumns = roleTargetColumns(targetRoles);
  const scopeColumns = facilityScopeColumns(params.facilityScope);

  const existing = await prisma.courseAssignment.findFirst({
    where: { organizationId, courseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (existing) {
    const updated = await prisma.courseAssignment.update({
      where: { id: existing.id },
      data: {
        assignedByAdminId: params.assignedByAdminId,
        ...settingsColumns(params),
        ...roleColumns,
        ...scopeColumns,
      },
      select: { id: true, dueAt: true, dueWindowDays: true },
    });

    for (const row of params.stageRows ?? []) {
      await prisma.assignmentReminderStage.upsert({
        where: { assignmentId_stage: { assignmentId: existing.id, stage: row.stage } },
        update: { offsetDays: row.offsetDays, enabled: row.enabled, channels: row.channels },
        create: { assignmentId: existing.id, ...row },
      });
    }

    logger.info({
      msg: '[enrollment] Existing course assignment updated',
      assignmentId: existing.id,
      organizationId,
      courseId,
      userId: params.assignedByAdminId,
    });
    return updated;
  }

  return prisma.courseAssignment.create({
    data: {
      organizationId,
      courseId,
      assignedByAdminId: params.assignedByAdminId,
      ...settingsColumns(params),
      ...roleColumns,
      ...scopeColumns,
      reminderStages: { create: params.stageRows ?? defaultStageRows() },
    },
    select: { id: true, dueAt: true, dueWindowDays: true },
  });
}
