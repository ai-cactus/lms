import type { EnrollmentStatus } from '@/generated/prisma/enums';

/**
 * Which statuses a learner's own writes may move, and in which direction
 * (BUG-53).
 *
 * Lesson and video progress only ever advance an enrolment through the reading
 * phase: enrolled/assigned → in_progress → lessons_complete. Everything past
 * that is decided by something else — the quiz (locked), the attestation
 * (attested/completed) or an admin (a retake) — and a progress report must
 * never overwrite it. When one could, a stray progress ping un-finished signed
 * training and released a learner from an attempt lockout.
 *
 * A `Record` over the enum so a new status is a compile error here rather than
 * a silently writable one. `null` means "not a reading-phase status: progress
 * leaves it alone".
 */
const READING_PHASE_RANK: Readonly<Record<EnrollmentStatus, number | null>> = {
  enrolled: 0,
  assigned: 0,
  in_progress: 1,
  lessons_complete: 2,
  completed: null,
  attested: null,
  locked: null,
  failed: null,
  retry_requested: null,
};

/**
 * The status an enrolment should hold after the learner reports `progress`
 * percent. Only ever moves forward within the reading phase; any other status
 * is returned unchanged.
 */
export function statusAfterProgress(current: EnrollmentStatus, progress: number): EnrollmentStatus {
  const currentRank = READING_PHASE_RANK[current];
  if (currentRank === null) return current;

  const target: EnrollmentStatus = progress >= 100 ? 'lessons_complete' : 'in_progress';
  const targetRank = READING_PHASE_RANK[target] ?? currentRank;
  return targetRank > currentRank ? target : current;
}

/**
 * Why the learner may not start, submit or reset the quiz on this enrolment,
 * or null when they may.
 *
 * - `finished`: the training is completed/attested. Grading another attempt
 *   would rewrite the score behind a signed attestation; a new cycle arrives as
 *   a new enrolment (an admin retake or a renewal), never by reopening this one.
 * - `locked`: attempts are exhausted and only an admin retake reopens it.
 */
export type QuizClosedReason = 'finished' | 'locked';

export function learnerQuizClosedReason(status: EnrollmentStatus): QuizClosedReason | null {
  if (status === 'completed' || status === 'attested') return 'finished';
  if (status === 'locked') return 'locked';
  return null;
}

export const QUIZ_ALREADY_COMPLETED_ERROR_CODE = 'QUIZ_ALREADY_COMPLETED';
export const QUIZ_ALREADY_COMPLETED_MESSAGE =
  'You have already completed this course, so the quiz is closed.';
export const QUIZ_LOCKED_ERROR_CODE = 'QUIZ_LOCKED_MAX_ATTEMPTS';
export const QUIZ_LOCKED_MESSAGE =
  'You have used all allowed attempts for this quiz. An admin must assign a retake.';
