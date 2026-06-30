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
};

/**
 * Stages the daily sweep evaluates, in chronological order. Excludes
 * `INITIAL_LAUNCH` (fired at assignment time, never by the sweep).
 */
export const SWEEP_STAGES: ReminderStage[] = [
  'FRIENDLY_REMINDER',
  'URGENT_REMINDER',
  'DAY_OF_DEADLINE',
  'GRACE_SOFT_ESCALATION',
  'HARD_ESCALATION',
];
