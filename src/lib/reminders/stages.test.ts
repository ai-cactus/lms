/**
 * Unit tests for src/lib/reminders/stages.ts
 *
 * Validates that the static stage defaults and sweep-stage list match the
 * documented 6-stage cadence. These are regression guards — a silent edit to an
 * offset or audience silently breaks the entire reminder schedule.
 */
import { describe, it, expect } from 'vitest';
import { REMINDER_STAGE_DEFAULTS, SWEEP_STAGES, SWEEP_LADDER_STAGES } from './stages';

describe('REMINDER_STAGE_DEFAULTS', () => {
  it('defines all 7 stages', () => {
    const stages = Object.keys(REMINDER_STAGE_DEFAULTS);
    expect(stages).toHaveLength(7);
    expect(stages).toContain('INITIAL_LAUNCH');
    expect(stages).toContain('FRIENDLY_REMINDER');
    expect(stages).toContain('URGENT_REMINDER');
    expect(stages).toContain('DAY_OF_DEADLINE');
    expect(stages).toContain('GRACE_SOFT_ESCALATION');
    expect(stages).toContain('HARD_ESCALATION');
    expect(stages).toContain('ADMIN_PRE_DEADLINE_REMINDER');
  });

  it('INITIAL_LAUNCH: fired at assignment time (offset 0, worker audience)', () => {
    const s = REMINDER_STAGE_DEFAULTS.INITIAL_LAUNCH;
    expect(s.offsetDays).toBe(0);
    expect(s.audience).toBe('worker');
    expect(s.channels).toContain('email');
    expect(s.channels).toContain('in_app');
  });

  it('FRIENDLY_REMINDER: 14 days before deadline, worker only', () => {
    const s = REMINDER_STAGE_DEFAULTS.FRIENDLY_REMINDER;
    expect(s.offsetDays).toBe(-14);
    expect(s.audience).toBe('worker');
  });

  it('URGENT_REMINDER: 3 days before deadline, worker only', () => {
    const s = REMINDER_STAGE_DEFAULTS.URGENT_REMINDER;
    expect(s.offsetDays).toBe(-3);
    expect(s.audience).toBe('worker');
  });

  it('DAY_OF_DEADLINE: offset 0 (same day as due date), worker only', () => {
    const s = REMINDER_STAGE_DEFAULTS.DAY_OF_DEADLINE;
    expect(s.offsetDays).toBe(0);
    expect(s.audience).toBe('worker');
  });

  it('GRACE_SOFT_ESCALATION: 3 days past deadline, escalates to worker AND recipients', () => {
    const s = REMINDER_STAGE_DEFAULTS.GRACE_SOFT_ESCALATION;
    expect(s.offsetDays).toBe(3);
    expect(s.audience).toBe('worker_and_escalation');
  });

  it('HARD_ESCALATION: 7 days past deadline, escalation recipients only', () => {
    const s = REMINDER_STAGE_DEFAULTS.HARD_ESCALATION;
    expect(s.offsetDays).toBe(7);
    expect(s.audience).toBe('escalation');
  });

  it('ADMIN_PRE_DEADLINE_REMINDER: 7 days before deadline, escalation recipients only', () => {
    const s = REMINDER_STAGE_DEFAULTS.ADMIN_PRE_DEADLINE_REMINDER;
    expect(s.offsetDays).toBe(-7);
    expect(s.audience).toBe('escalation');
    expect(s.channels).toContain('email');
    expect(s.channels).toContain('in_app');
  });

  it('every stage specifies at least one channel', () => {
    for (const [stage, cfg] of Object.entries(REMINDER_STAGE_DEFAULTS)) {
      expect(cfg.channels.length, `stage ${stage} must have channels`).toBeGreaterThan(0);
    }
  });
});

describe('SWEEP_STAGES', () => {
  it('contains exactly 5 stages (all except INITIAL_LAUNCH)', () => {
    expect(SWEEP_STAGES).toHaveLength(5);
  });

  it('does NOT include INITIAL_LAUNCH (fired at assignment time, not by the daily sweep)', () => {
    expect(SWEEP_STAGES).not.toContain('INITIAL_LAUNCH');
  });

  it('includes all other stages in chronological order', () => {
    expect(SWEEP_STAGES).toEqual([
      'FRIENDLY_REMINDER',
      'URGENT_REMINDER',
      'DAY_OF_DEADLINE',
      'GRACE_SOFT_ESCALATION',
      'HARD_ESCALATION',
    ]);
  });

  it('every SWEEP_STAGE is a key in REMINDER_STAGE_DEFAULTS', () => {
    for (const stage of SWEEP_STAGES) {
      expect(REMINDER_STAGE_DEFAULTS).toHaveProperty(stage);
    }
  });

  // Issue #8 / TC-024: ADMIN_PRE_DEADLINE_REMINDER is a fixed, non-configurable
  // admin stage — it must never surface in the assignment reminder-schedule
  // form (which is driven by SWEEP_STAGES) or be seeded as an overridable
  // AssignmentReminderStage row (defaultStageRows() in enrollment.ts maps over
  // SWEEP_STAGES). Confirmed here even though the exact-array-equality test
  // above already implies it, since this is the specific regression this stage
  // exists to guard against.
  it('does NOT include ADMIN_PRE_DEADLINE_REMINDER (fixed, not worker-editable)', () => {
    expect(SWEEP_STAGES).not.toContain('ADMIN_PRE_DEADLINE_REMINDER');
  });
});

describe('SWEEP_LADDER_STAGES', () => {
  it('is SWEEP_STAGES plus ADMIN_PRE_DEADLINE_REMINDER appended at the end', () => {
    expect(SWEEP_LADDER_STAGES).toEqual([...SWEEP_STAGES, 'ADMIN_PRE_DEADLINE_REMINDER']);
  });

  it('contains exactly 6 stages — the full set the daily sweep evaluates', () => {
    expect(SWEEP_LADDER_STAGES).toHaveLength(6);
  });
});
