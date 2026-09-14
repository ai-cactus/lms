/**
 * Pure arithmetic shared by both dashboard actions — see `metrics.ts`'s module
 * doc-comment for why the passing-score definition had to be unified (invariant
 * B: the same enrollment must not pass on one dashboard and fail on the other).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSING_SCORE,
  coveragePercentages,
  passingScoreFor,
  resolvePassingScores,
} from './metrics';

describe('resolvePassingScores', () => {
  it('takes the strictest bar across a course-level quiz and its lesson-level quizzes', () => {
    const scores = resolvePassingScores([
      { courseId: 'course-1', passingScore: 70 },
      { passingScore: 85, lesson: { courseId: 'course-1' } },
      { passingScore: 60, lesson: { courseId: 'course-1' } },
    ]);

    // The legacy bug: it took the FIRST lesson quiz it found (60), not the
    // strictest (85) — the same enrollment then passed here and failed on the
    // global dashboard, which already took the strictest.
    expect(scores.get('course-1')).toBe(85);
  });

  it('resolves a lesson-level quiz back to its course via `lesson.courseId`', () => {
    const scores = resolvePassingScores([{ passingScore: 90, lesson: { courseId: 'course-2' } }]);

    expect(scores.get('course-2')).toBe(90);
  });

  it('drops a quiz with neither a courseId nor a lesson — it cannot be attributed', () => {
    const scores = resolvePassingScores([{ passingScore: 90 }]);

    expect(scores.size).toBe(0);
  });

  it('a course with no quiz at all is absent from the map', () => {
    const scores = resolvePassingScores([]);

    expect(scores.has('course-without-a-quiz')).toBe(false);
  });
});

describe('passingScoreFor', () => {
  it('returns the resolved bar for a course that has one', () => {
    const scores = resolvePassingScores([{ courseId: 'course-1', passingScore: 85 }]);

    expect(passingScoreFor(scores, 'course-1')).toBe(85);
  });

  it(`falls back to the default (${DEFAULT_PASSING_SCORE}) for a course with no quiz`, () => {
    const scores = resolvePassingScores([]);

    expect(passingScoreFor(scores, 'course-without-a-quiz')).toBe(DEFAULT_PASSING_SCORE);
  });
});

describe('coveragePercentages', () => {
  it('returns all zeros without dividing by zero when the base is zero', () => {
    expect(coveragePercentages({ completed: 0, inProgress: 0, notStarted: 0 }, 0)).toEqual({
      completed: 0,
      inProgress: 0,
      notStarted: 0,
    });
  });

  it('sums to exactly 100 on an even split', () => {
    const result = coveragePercentages({ completed: 5, inProgress: 3, notStarted: 2 }, 10);

    expect(result).toEqual({ completed: 50, inProgress: 30, notStarted: 20 });
  });

  it('sums to exactly 100 on a three-way tie, breaking ties toward completed then inProgress', () => {
    // 1/3 each of 10 -> 33.33 / 33.33 / 33.33 raw; three independent
    // Math.rounds would read 33/33/33 (=99) or 33/33/34 depending on rounding
    // mode. Largest-remainder distributes the leftover point deterministically.
    const result = coveragePercentages({ completed: 10, inProgress: 10, notStarted: 10 }, 30);

    expect(result.completed + result.inProgress + result.notStarted).toBe(100);
    expect(result).toEqual({ completed: 34, inProgress: 33, notStarted: 33 });
  });

  it('always sums to 100 for an arbitrary uneven split (regression net for the rounding remainder)', () => {
    const counts = { completed: 7, inProgress: 4, notStarted: 3 };
    const result = coveragePercentages(counts, 14);

    expect(result.completed + result.inProgress + result.notStarted).toBe(100);
  });
});
