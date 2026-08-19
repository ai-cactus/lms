import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { REMINDER_STAGE_DEFAULTS, SWEEP_STAGES } from '@/lib/reminders/stages';
import type { RenewalCycle, ReminderStage, UserRole } from '@/generated/prisma/enums';

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
 * Ladder stages the course wizard's "N days before" reminder rows map onto, in
 * the order a row list is consumed (furthest-out row first). Only the
 * worker-audience pre-deadline stages are listed: the grace/overdue stages
 * notify the escalation manager AFTER the deadline, so they are never driven by
 * the wizard rows and always keep their canonical defaults.
 */
export const WIZARD_REMINDER_STAGES: ReminderStage[] = [
  'FRIENDLY_REMINDER',
  'URGENT_REMINDER',
  'DAY_OF_DEADLINE',
];

/** How many wizard reminder rows the ladder can represent. */
export const MAX_WIZARD_REMINDER_ROWS = WIZARD_REMINDER_STAGES.length;

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

  return defaultStageRows().map((row) => {
    const position = WIZARD_REMINDER_STAGES.indexOf(row.stage);
    if (position === -1) return row;

    const days = offsets[position];
    if (days === undefined) return { ...row, enabled: false };
    // `days === 0` is the day of the deadline; negating it would store -0.
    return { ...row, offsetDays: days === 0 ? 0 : -days, enabled: true };
  });
}

export interface UpsertCourseAssignmentParams {
  organizationId: string;
  courseId: string;
  assignedByAdminId: string;
  scheduleAt: Date | null;
  dueAt: Date | null;
  dueWindowDays: number | null;
  remindersEnabled: boolean;
  renewalCycle: RenewalCycle;
  stageRows: StageRowInput[];
  /**
   * Roles this assignment targets. `undefined` leaves the existing value untouched
   * (an individual re-assignment must never clear a course's role targeting);
   * `null` / `[]` explicitly clears it; a non-empty list sets it.
   */
  targetRoles?: UserRole[] | null;
  /**
   * `'write'` (default) overwrites an existing assignment's settings and stage
   * rows. `'preserve'` links the existing row without touching them — the row is
   * shared org-wide, so assigning to one worker must not silently retune the
   * reminder ladder for everyone already enrolled.
   */
  settingsMode?: 'write' | 'preserve';
}

/**
 * The two role-target columns written together, so a row is never internally
 * inconsistent: `targetRoles` is the authoritative list, and the superseded
 * single-value `targetRole` keeps carrying the FIRST role for the readers that
 * still use it (the nightly reminder sweep's role-target reconcile pre-pass and
 * the assign page's mode detection).
 */
function roleTargetColumns(targetRoles: UserRole[] | null | undefined) {
  if (targetRoles === undefined) return {};
  if (targetRoles === null || targetRoles.length === 0) {
    return { targetRole: null, targetRoles: [] };
  }
  return { targetRole: targetRoles[0], targetRoles };
}

/**
 * Create or update the org's single {@link CourseAssignment} for a course and
 * reconcile its per-stage reminder cadence. One assignment per
 * `(organizationId, courseId)`: reuse the most recent row so already-enrolled
 * workers keep firing off the same (now updated) schedule/ladder. Stage rows are
 * upserted on the `(assignmentId, stage)` unique key — never duplicated — and
 * stages outside the submitted set survive. Returns the assignment id. With
 * `settingsMode: 'preserve'` an existing row is returned untouched.
 */
export async function upsertCourseAssignment(
  params: UpsertCourseAssignmentParams,
): Promise<string> {
  const { organizationId, courseId, targetRoles } = params;
  const roleColumns = roleTargetColumns(targetRoles);

  const existing = await prisma.courseAssignment.findFirst({
    where: { organizationId, courseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (existing) {
    if (params.settingsMode === 'preserve') {
      logger.info({
        msg: '[enrollment] Existing course assignment reused — settings preserved',
        assignmentId: existing.id,
        organizationId,
        courseId,
        userId: params.assignedByAdminId,
      });
      return existing.id;
    }

    await prisma.courseAssignment.update({
      where: { id: existing.id },
      data: {
        assignedByAdminId: params.assignedByAdminId,
        scheduleAt: params.scheduleAt,
        dueAt: params.dueAt,
        dueWindowDays: params.dueWindowDays,
        remindersEnabled: params.remindersEnabled,
        renewalCycle: params.renewalCycle,
        ...roleColumns,
      },
    });

    for (const row of params.stageRows) {
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
    return existing.id;
  }

  const created = await prisma.courseAssignment.create({
    data: {
      organizationId,
      courseId,
      assignedByAdminId: params.assignedByAdminId,
      scheduleAt: params.scheduleAt,
      dueAt: params.dueAt,
      dueWindowDays: params.dueWindowDays,
      remindersEnabled: params.remindersEnabled,
      renewalCycle: params.renewalCycle,
      ...roleColumns,
      reminderStages: { create: params.stageRows },
    },
  });
  return created.id;
}
