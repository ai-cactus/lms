import type { ReminderStage } from '@/generated/prisma/enums';

/**
 * Reminder ladder — single source of truth.
 *
 * Mirrors the 6-stage cadence in `docs/Reminders_and_Escalations.csv`. These are
 * the system defaults; an admin may override `offsetDays`/`enabled`/`channels`
 * per assignment via `AssignmentReminderStage` rows (the sweep prefers those and
 * falls back to these defaults). `offsetDays` is signed and relative to the
 * enrollment's `dueAt`: negative = before the deadline, 0 = day-of, positive =
 * after (overdue / escalation).
 */

/** Who a stage notifies. */
export type ReminderAudience = 'worker' | 'worker_and_escalation' | 'escalation';

export interface ReminderStageDefault {
  /** Signed day offset from the deadline (`dueAt`). */
  offsetDays: number;
  /** Delivery channels for this stage (`'email'`, `'in_app'`). */
  channels: string[];
  /** Audience the stage targets. */
  audience: ReminderAudience;
}

/**
 * Default config for every stage. `INITIAL_LAUNCH` is fired at assignment time
 * (Phase 7), not by the daily sweep — it is included here so the assignment flow
 * can seed stage rows from one canonical map, but it is intentionally excluded
 * from {@link SWEEP_STAGES}.
 */
export const REMINDER_STAGE_DEFAULTS: Record<ReminderStage, ReminderStageDefault> = {
  INITIAL_LAUNCH: { offsetDays: 0, channels: ['email', 'in_app'], audience: 'worker' },
  FRIENDLY_REMINDER: { offsetDays: -14, channels: ['email', 'in_app'], audience: 'worker' },
  URGENT_REMINDER: { offsetDays: -3, channels: ['email', 'in_app'], audience: 'worker' },
  DAY_OF_DEADLINE: { offsetDays: 0, channels: ['email', 'in_app'], audience: 'worker' },
  GRACE_SOFT_ESCALATION: {
    offsetDays: 3,
    channels: ['email', 'in_app'],
    audience: 'worker_and_escalation',
  },
  HARD_ESCALATION: { offsetDays: 7, channels: ['email', 'in_app'], audience: 'escalation' },
  // Fixed 7-day pre-deadline heads-up to the assignment's escalation manager
  // (Issue #8). Deliberately NOT worker-editable — see SWEEP_STAGES below.
  ADMIN_PRE_DEADLINE_REMINDER: {
    offsetDays: -7,
    channels: ['email', 'in_app'],
    audience: 'escalation',
  },
};

/**
 * The worker-editable ladder stages, in chronological order. Drives the
 * assignment reminder-schedule form and the per-assignment `defaultStageRows()`
 * seed. Excludes `INITIAL_LAUNCH` (fired at assignment time, never by the sweep)
 * and `ADMIN_PRE_DEADLINE_REMINDER` (a fixed, non-configurable admin stage — it
 * must never surface in the schedule form or be seeded as an overridable row).
 */
export const SWEEP_STAGES: ReminderStage[] = [
  'FRIENDLY_REMINDER',
  'URGENT_REMINDER',
  'DAY_OF_DEADLINE',
  'GRACE_SOFT_ESCALATION',
  'HARD_ESCALATION',
];

/**
 * The full set of stages the daily sweep evaluates: the editable ladder plus the
 * fixed `ADMIN_PRE_DEADLINE_REMINDER`. The admin stage is appended here (not in
 * {@link SWEEP_STAGES}) so the sweep dispatches it while the assignment form and
 * seeded stage rows exclude it — it always uses its {@link REMINDER_STAGE_DEFAULTS}.
 */
export const SWEEP_LADDER_STAGES: ReminderStage[] = [
  ...SWEEP_STAGES,
  'ADMIN_PRE_DEADLINE_REMINDER',
];
