/**
 * Course progress as shown to a worker.
 *
 * Viewing every lesson is no longer enough to reach 100% — a course is only
 * fully complete once the quiz has been PASSED and the completion has been
 * ATTESTED. Progress is therefore split into three milestones:
 *
 *   • Lessons viewed ........ up to 80%
 *   • Quiz passed ........... +10%
 *   • Attestation signed .... +10%  (only reachable via the `attested` status)
 *
 * This guarantees the bar can only read 100% for an attested enrollment, while
 * still moving meaningfully as the worker watches lessons and passes the quiz.
 */

const DEFAULT_PASSING_SCORE = 70;

const LESSON_WEIGHT = 0.8; // 80% of the bar is lesson completion
const QUIZ_BONUS = 10; // passing the quiz adds 10%

export interface DisplayProgressInput {
  /** Current enrollment status (e.g. in_progress, lessons_complete, attested). */
  status: string;
  /** Raw lesson-viewing progress, 0–100. */
  progress: number;
  /** Latest quiz score, or null if the quiz hasn't been taken. */
  score: number | null;
  /** The course quiz's passing score, or null when unknown. */
  passingScore: number | null;
}

export function computeDisplayProgress({
  status,
  progress,
  score,
  passingScore,
}: DisplayProgressInput): number {
  // Attested is the only fully-complete state.
  if (status === 'attested') return 100;

  const lessons = Math.max(0, Math.min(progress, 100)) * LESSON_WEIGHT; // 0–80
  const pass = passingScore ?? DEFAULT_PASSING_SCORE;
  const quizPassed = status === 'completed' || (score != null && score >= pass);
  const quizPart = quizPassed ? QUIZ_BONUS : 0;

  // Cap below 100 — the final 10% is reserved for attestation, handled above.
  return Math.min(99, Math.round(lessons + quizPart));
}
