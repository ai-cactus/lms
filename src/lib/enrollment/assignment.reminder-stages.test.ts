/**
 * Tests for the course wizard's "remind N days before" → reminder-ladder mapping.
 *
 * The wizard collects free-form whole-day offsets while the schedule is a fixed
 * stage enum, so `reminderDaysToStageRows` is the one place that reconciles the
 * two. Pure function — no DB involved.
 */
import { describe, it, expect } from 'vitest';

import {
  MAX_WIZARD_REMINDER_ROWS,
  WIZARD_REMINDER_STAGES,
  defaultStageRows,
  reminderDaysToStageRows,
} from './assignment';

function byStage(rows: ReturnType<typeof reminderDaysToStageRows>) {
  return Object.fromEntries(rows.map((row) => [row.stage, row]));
}

describe('reminderDaysToStageRows', () => {
  it('maps the rows furthest from the deadline onto the ladder in order, as negative offsets', () => {
    const rows = byStage(reminderDaysToStageRows([7, 3, 1]));

    expect(rows.FRIENDLY_REMINDER).toMatchObject({ offsetDays: -7, enabled: true });
    expect(rows.URGENT_REMINDER).toMatchObject({ offsetDays: -3, enabled: true });
    expect(rows.DAY_OF_DEADLINE).toMatchObject({ offsetDays: -1, enabled: true });
  });

  it('sorts the rows furthest-out first regardless of the order they were entered', () => {
    expect(reminderDaysToStageRows([1, 7, 3])).toEqual(reminderDaysToStageRows([7, 3, 1]));
  });

  it('disables the ladder stages no reminder row was given for', () => {
    const rows = byStage(reminderDaysToStageRows([5]));

    expect(rows.FRIENDLY_REMINDER).toMatchObject({ offsetDays: -5, enabled: true });
    expect(rows.URGENT_REMINDER.enabled).toBe(false);
    expect(rows.DAY_OF_DEADLINE.enabled).toBe(false);
  });

  it('leaves the post-deadline escalation stages at their canonical defaults', () => {
    const rows = byStage(reminderDaysToStageRows([7, 3, 1]));
    const defaults = byStage(defaultStageRows());

    expect(rows.GRACE_SOFT_ESCALATION).toEqual(defaults.GRACE_SOFT_ESCALATION);
    expect(rows.HARD_ESCALATION).toEqual(defaults.HARD_ESCALATION);
  });

  it('seeds every sweep stage — never the fixed admin stage', () => {
    const stages = reminderDaysToStageRows([7]).map((row) => row.stage);

    expect(stages).toEqual(defaultStageRows().map((row) => row.stage));
    expect(stages).not.toContain('ADMIN_PRE_DEADLINE_REMINDER');
  });

  it('drops duplicate and out-of-capacity rows', () => {
    const rows = byStage(reminderDaysToStageRows([10, 10, 7, 3, 1]));

    expect(rows.FRIENDLY_REMINDER.offsetDays).toBe(-10);
    expect(rows.URGENT_REMINDER.offsetDays).toBe(-7);
    expect(rows.DAY_OF_DEADLINE.offsetDays).toBe(-3);
    expect(WIZARD_REMINDER_STAGES).toHaveLength(MAX_WIZARD_REMINDER_ROWS);
  });

  it('ignores negative and non-finite rows', () => {
    const rows = byStage(reminderDaysToStageRows([Number.NaN, -4, 2]));

    expect(rows.FRIENDLY_REMINDER).toMatchObject({ offsetDays: -2, enabled: true });
    expect(rows.URGENT_REMINDER.enabled).toBe(false);
  });

  it('disables the whole worker ladder when every reminder row was removed', () => {
    const rows = reminderDaysToStageRows([]);

    for (const stage of WIZARD_REMINDER_STAGES) {
      expect(rows.find((row) => row.stage === stage)?.enabled).toBe(false);
    }
  });

  it('maps a "0 days before" row onto the day-of-deadline offset', () => {
    expect(byStage(reminderDaysToStageRows([0])).FRIENDLY_REMINDER.offsetDays).toBe(0);
  });
});
