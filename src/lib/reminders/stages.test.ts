/**
 * Unit tests for src/lib/reminders/stages.ts
 *
 * Validates that the static stage defaults and sweep-stage list match the
 * documented 6-stage cadence. These are regression guards — a silent edit to an
 * offset or audience silently breaks the entire reminder schedule.
 */
import { describe, it, expect } from 'vitest';
import { REMINDER_STAGE_DEFAULTS, SWEEP_STAGES } from './stages';

describe('REMINDER_STAGE_DEFAULTS', () => {
  it('defines all 6 stages', () => {
    const stages = Object.keys(REMINDER_STAGE_DEFAULTS);
    expect(stages).toHaveLength(6);
    expect(stages).toContain('INITIAL_LAUNCH');
    expect(stages).toContain('FRIENDLY_REMINDER');
    expect(stages).toContain('URGENT_REMINDER');
    expect(stages).toContain('DAY_OF_DEADLINE');
    expect(stages).toContain('GRACE_SOFT_ESCALATION');
    expect(stages).toContain('HARD_ESCALATION');
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
});
