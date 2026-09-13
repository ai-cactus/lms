/**
 * Tests for `stageRowsToReminderDays` — the new inverse of
 * `reminderDaysToStageRows` (tested in `assignment.reminder-stages.test.ts`),
 * reading a stored `AssignmentReminderStage` ladder back into "N days before"
 * rows for a surface (AssignPublishClient) prefilling its editor. Nothing
 * exercised this function before this phase.
 *
 * Also covers the round-trip invariant the whole "N days before" vocabulary
 * rests on: `stageRowsToReminderDays(reminderDaysToStageRows(d)) === d` for any
 * valid day list, and a hydrate → submit cycle on an already-canonical stored
 * ladder reproduces it exactly, so a no-op re-save changes nothing.
 */
import { describe, it, expect } from 'vitest';
import type { ReminderStage } from '@/generated/prisma/enums';

import {
  DEFAULT_WIZARD_REMINDER_DAYS,
  MAX_WIZARD_REMINDER_ROWS,
  WIZARD_REMINDER_STAGES,
  stageRowsToReminderDays,
} from './reminder-ladder';
import { reminderDaysToStageRows } from './assignment';

type Row = { stage: ReminderStage; offsetDays: number; enabled: boolean };

function row(stage: ReminderStage, offsetDays: number, enabled = true): Row {
  return { stage, offsetDays, enabled };
}

describe('stageRowsToReminderDays', () => {
  it('reads the three wizard stages back as positive "days before" values', () => {
    const rows: Row[] = [
      row('FRIENDLY_REMINDER', -14),
      row('URGENT_REMINDER', -3),
      row('DAY_OF_DEADLINE', 0),
    ];

    expect(stageRowsToReminderDays(rows)).toEqual([14, 3, 0]);
  });

  it('drops a disabled row entirely rather than showing it as a zeroed value', () => {
    const rows: Row[] = [
      row('FRIENDLY_REMINDER', -14, false),
      row('URGENT_REMINDER', -3, true),
      row('DAY_OF_DEADLINE', 0, true),
    ];

    expect(stageRowsToReminderDays(rows)).toEqual([3, 0]);
  });

  it('drops the two post-deadline escalation stages even when enabled — they are outside this vocabulary', () => {
    const rows: Row[] = [
      row('FRIENDLY_REMINDER', -14),
      row('GRACE_SOFT_ESCALATION', 3),
      row('HARD_ESCALATION', 7),
    ];

    expect(stageRowsToReminderDays(rows)).toEqual([14]);
  });

  it('drops the fixed ADMIN_PRE_DEADLINE_REMINDER stage even when enabled', () => {
    const rows: Row[] = [row('FRIENDLY_REMINDER', -14), row('ADMIN_PRE_DEADLINE_REMINDER', -7)];

    expect(stageRowsToReminderDays(rows)).toEqual([14]);
  });

  it('drops an enabled wizard-stage row with a positive offset — a programmatic override outside "days before"', () => {
    const rows: Row[] = [row('FRIENDLY_REMINDER', 5), row('URGENT_REMINDER', -3)];

    expect(stageRowsToReminderDays(rows)).toEqual([3]);
  });

  it('never produces -0 for a day-of-deadline row', () => {
    const [days] = stageRowsToReminderDays([row('DAY_OF_DEADLINE', 0)]);

    expect(days).toBe(0);
    expect(Object.is(days, -0)).toBe(false);
  });

  it('caps the result at MAX_WIZARD_REMINDER_ROWS even given more matching rows than that (malformed duplicate stage entries)', () => {
    const rows: Row[] = [
      row('FRIENDLY_REMINDER', -30),
      row('FRIENDLY_REMINDER', -20),
      row('URGENT_REMINDER', -10),
      row('DAY_OF_DEADLINE', 0),
    ];

    expect(stageRowsToReminderDays(rows)).toHaveLength(MAX_WIZARD_REMINDER_ROWS);
  });

  it('sorts the result furthest-out first regardless of the input row order', () => {
    const rows: Row[] = [
      row('DAY_OF_DEADLINE', 0),
      row('FRIENDLY_REMINDER', -14),
      row('URGENT_REMINDER', -3),
    ];

    expect(stageRowsToReminderDays(rows)).toEqual([14, 3, 0]);
  });

  it('returns an empty list when every wizard stage is disabled — "no pre-deadline reminders"', () => {
    const rows = WIZARD_REMINDER_STAGES.map((stage) => row(stage, -1, false));

    expect(stageRowsToReminderDays(rows)).toEqual([]);
  });

  it('returns an empty list given no rows at all', () => {
    expect(stageRowsToReminderDays([])).toEqual([]);
  });
});

describe('DEFAULT_WIZARD_REMINDER_DAYS', () => {
  it('is the canonical [14, 3, 0] cadence a fresh course starts from', () => {
    expect(DEFAULT_WIZARD_REMINDER_DAYS).toEqual([14, 3, 0]);
  });
});

describe('round-trip invariant: stageRowsToReminderDays(reminderDaysToStageRows(d)) === d', () => {
  // A property-style sweep rather than a handful of examples, per the phase's
  // own request: every subset of size 0-3 from this candidate pool, sorted
  // descending (the canonical shape `reminderDaysToStageRows` itself expects/
  // produces), covering zero, small, large, and duplicate-free day values.
  const CANDIDATES = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90];

  function combinations<T>(items: T[], size: number): T[][] {
    if (size === 0) return [[]];
    if (items.length < size) return [];
    const [first, ...rest] = items;
    const withFirst = combinations(rest, size - 1).map((combo) => [first, ...combo]);
    const withoutFirst = combinations(rest, size);
    return [...withFirst, ...withoutFirst];
  }

  const validDayLists: number[][] = [0, 1, 2, 3]
    .flatMap((size) => combinations(CANDIDATES, size))
    .map((combo) => [...combo].sort((a, b) => b - a));

  it(`sweeps ${validDayLists.length} distinct valid day lists`, () => {
    expect(validDayLists.length).toBeGreaterThan(300);
  });

  // Wrapped as 1-tuples (`[d]`) rather than passing `validDayLists` directly:
  // `it.each` spreads an inner array's own elements as separate positional
  // params, which would silently rebind `days` to a bare number (or undefined)
  // for every 0/1/2-element day list instead of the intended array.
  it.each(validDayLists.map((d) => [d]))('round-trips %j', (days) => {
    expect(stageRowsToReminderDays(reminderDaysToStageRows(days))).toEqual(days);
  });
});

describe('hydrate → submit round trip on a canonical stored ladder', () => {
  it.each([[14, 3, 0], [7], [], [21, 5], [0]].map((d) => [d]))(
    'reminderDaysToStageRows(stageRowsToReminderDays(stored)) === stored, for stored produced from %j',
    (days) => {
      const stored = reminderDaysToStageRows(days);
      const hydrated = stageRowsToReminderDays(stored);
      const resubmitted = reminderDaysToStageRows(hydrated);

      // A no-op re-save (edit nothing, submit) must not drift the stored ladder.
      expect(resubmitted).toEqual(stored);
    },
  );
});
