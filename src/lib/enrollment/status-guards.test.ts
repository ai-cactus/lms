import { describe, it, expect } from 'vitest';
import type { EnrollmentStatus } from '@/generated/prisma/enums';
import { learnerQuizClosedReason, statusAfterProgress } from './status-guards';

const NON_READING_STATUSES: EnrollmentStatus[] = [
  'completed',
  'attested',
  'locked',
  'failed',
  'retry_requested',
];

describe('statusAfterProgress (BUG-53)', () => {
  it.each([
    ['enrolled', 40, 'in_progress'],
    ['assigned', 40, 'in_progress'],
    ['enrolled', 100, 'lessons_complete'],
    ['assigned', 100, 'lessons_complete'],
    ['in_progress', 40, 'in_progress'],
    ['in_progress', 100, 'lessons_complete'],
  ] as const)('moves %s forward to %s at %i%%', (current, progress, expected) => {
    expect(statusAfterProgress(current, progress)).toBe(expected);
  });

  it('never pulls lessons_complete back to in_progress (the video gate sets it at 95%)', () => {
    expect(statusAfterProgress('lessons_complete', 97)).toBe('lessons_complete');
    expect(statusAfterProgress('lessons_complete', 100)).toBe('lessons_complete');
  });

  it.each(NON_READING_STATUSES)('leaves "%s" untouched at any progress', (status) => {
    expect(statusAfterProgress(status, 1)).toBe(status);
    expect(statusAfterProgress(status, 50)).toBe(status);
    expect(statusAfterProgress(status, 100)).toBe(status);
  });
});

describe('learnerQuizClosedReason', () => {
  it.each(['completed', 'attested'] as const)('closes the quiz on finished "%s"', (status) => {
    expect(learnerQuizClosedReason(status)).toBe('finished');
  });

  it('closes the quiz on a locked enrolment', () => {
    expect(learnerQuizClosedReason('locked')).toBe('locked');
  });

  it.each([
    'enrolled',
    'assigned',
    'in_progress',
    'lessons_complete',
    'failed',
    'retry_requested',
  ] as const)('leaves the quiz open on "%s"', (status) => {
    expect(learnerQuizClosedReason(status)).toBeNull();
  });
});
