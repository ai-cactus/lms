/**
 * Regression tests for the learner course-list selection rule.
 *
 * Bug: `/worker` and `/worker/trainings` both ended their dedupe with
 * `const picked = completed ?? e`, so a completed/attested enrollment always
 * beat the newest one. A learner holding an admin-assigned retake (a NEW
 * enrollment row with `retakeOf` set) therefore still saw the old "Attested"
 * row, while `/learn/[id]` — which selects `orderBy: { startedAt: 'desc' }` —
 * was already operating on the retake. The two views must agree.
 */
import { describe, it, expect } from 'vitest';

import { selectDisplayEnrollments, isActionableEnrollmentStatus } from './display-selection';

function enrollment(overrides: Partial<Row> & Pick<Row, 'id'>): Row {
  return {
    courseId: 'course-1',
    status: 'enrolled',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface Row {
  id: string;
  courseId: string;
  status: string;
  startedAt: Date | string | null;
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('isActionableEnrollmentStatus', () => {
  it.each(['enrolled', 'assigned', 'in_progress', 'lessons_complete', 'locked'])(
    'treats %s as actionable',
    (status) => {
      expect(isActionableEnrollmentStatus(status)).toBe(true);
    },
  );

  it.each(['completed', 'attested', 'failed', 'retry_requested'])(
    'treats %s as terminal',
    (status) => {
      expect(isActionableEnrollmentStatus(status)).toBe(false);
    },
  );
});

describe('selectDisplayEnrollments', () => {
  it('prefers a newer retake enrollment over an attested one for the same course', () => {
    const picked = selectDisplayEnrollments([
      enrollment({
        id: 'attested',
        status: 'attested',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      enrollment({
        id: 'retake',
        status: 'enrolled',
        startedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ]);

    expect(ids(picked)).toEqual(['retake']);
  });

  it('still prefers the actionable row when it is listed first', () => {
    const picked = selectDisplayEnrollments([
      enrollment({
        id: 'retake',
        status: 'enrolled',
        startedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
      enrollment({
        id: 'completed',
        status: 'completed',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);

    expect(ids(picked)).toEqual(['retake']);
  });

  it('keeps a locked enrollment visible rather than masking it with an older completion', () => {
    const picked = selectDisplayEnrollments([
      enrollment({
        id: 'completed',
        status: 'completed',
        startedAt: new Date('2025-01-01T00:00:00.000Z'),
      }),
      enrollment({
        id: 'locked',
        status: 'locked',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);

    expect(ids(picked)).toEqual(['locked']);
  });

  it('falls back to the newest terminal row when nothing is actionable', () => {
    const picked = selectDisplayEnrollments([
      enrollment({
        id: 'old',
        status: 'completed',
        startedAt: new Date('2024-01-01T00:00:00.000Z'),
      }),
      enrollment({
        id: 'new',
        status: 'attested',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);

    expect(ids(picked)).toEqual(['new']);
  });

  it('picks the newest of several actionable rows', () => {
    const picked = selectDisplayEnrollments([
      enrollment({
        id: 'a',
        status: 'in_progress',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      enrollment({ id: 'c', status: 'enrolled', startedAt: new Date('2026-03-01T00:00:00.000Z') }),
      enrollment({ id: 'b', status: 'locked', startedAt: new Date('2026-02-01T00:00:00.000Z') }),
    ]);

    expect(ids(picked)).toEqual(['c']);
  });

  it('accepts ISO strings as well as Date instances', () => {
    const picked = selectDisplayEnrollments([
      enrollment({ id: 'older', status: 'in_progress', startedAt: '2026-01-01T00:00:00.000Z' }),
      enrollment({ id: 'newer', status: 'in_progress', startedAt: '2026-05-01T00:00:00.000Z' }),
    ]);

    expect(ids(picked)).toEqual(['newer']);
  });

  it('ranks a null startedAt below any dated row, and keeps the first on a tie', () => {
    const nullOnly = selectDisplayEnrollments([
      enrollment({ id: 'undated', status: 'enrolled', startedAt: null }),
      enrollment({
        id: 'dated',
        status: 'enrolled',
        startedAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    ]);
    expect(ids(nullOnly)).toEqual(['dated']);

    const tie = selectDisplayEnrollments([
      enrollment({ id: 'first', startedAt: new Date('2026-01-01T00:00:00.000Z') }),
      enrollment({ id: 'second', startedAt: new Date('2026-01-01T00:00:00.000Z') }),
    ]);
    expect(ids(tie)).toEqual(['first']);
  });

  it('returns one row per course, in first-appearance order', () => {
    const picked = selectDisplayEnrollments([
      enrollment({ id: 'b1', courseId: 'course-b', status: 'attested' }),
      enrollment({ id: 'a1', courseId: 'course-a', status: 'in_progress' }),
      enrollment({
        id: 'b2',
        courseId: 'course-b',
        status: 'enrolled',
        startedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ]);

    expect(ids(picked)).toEqual(['b2', 'a1']);
  });

  it('returns an empty list for no enrollments', () => {
    expect(selectDisplayEnrollments([])).toEqual([]);
  });
});
