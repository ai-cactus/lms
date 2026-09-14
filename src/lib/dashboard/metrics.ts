/**
 * Arithmetic shared by the two dashboard actions, deliberately free of Prisma.
 *
 * The dashboards legitimately count different things; they must never disagree
 * about how a shared concept is DEFINED. The passing bar did: the single-facility
 * dashboard took the first lesson that happened to carry a quiz, while the global
 * dashboard took the strictest bar across a course's lesson- and course-level
 * quizzes. The same enrollment therefore passed on one screen and failed on the
 * other. The strictest bar is the correct one, and it now has one implementation.
 */

/** Passing bar applied when a course carries no quiz of its own. */
export const DEFAULT_PASSING_SCORE = 70;

/**
 * A quiz row as Prisma returns it. A quiz hangs off either a lesson or the course
 * directly, so both attachment points have to be resolved back to a course.
 */
export interface QuizPassingScore {
  passingScore: number;
  courseId?: string | null;
  lesson?: { courseId: string } | null;
}

/** Each course's strictest passing bar. Courses with no quiz are absent. */
export function resolvePassingScores(quizzes: Iterable<QuizPassingScore>): Map<string, number> {
  const byCourseId = new Map<string, number>();

  for (const quiz of quizzes) {
    const courseId = quiz.courseId ?? quiz.lesson?.courseId;
    if (!courseId) continue;

    const current = byCourseId.get(courseId);
    if (current === undefined || quiz.passingScore > current) {
      byCourseId.set(courseId, quiz.passingScore);
    }
  }

  return byCourseId;
}

/** The course's passing bar, or {@link DEFAULT_PASSING_SCORE} when it has none. */
export function passingScoreFor(
  passingScores: ReadonlyMap<string, number>,
  courseId: string,
): number {
  return passingScores.get(courseId) ?? DEFAULT_PASSING_SCORE;
}

/** Staff counts making up a training-coverage split. */
export interface CoverageCounts {
  completed: number;
  inProgress: number;
  notStarted: number;
}

/**
 * The coverage split as percentages, apportioned by largest remainder (Hamilton)
 * so the three always sum to exactly 100 — three independent `Math.round`s
 * produce a legend reading 33/33/33 or 34/33/34 for the same data.
 *
 * Ties go to `completed`, then `inProgress`: the sort is stable and the entries
 * are built in that order.
 */
export function coveragePercentages(counts: CoverageCounts, base: number): CoverageCounts {
  if (base <= 0) return { completed: 0, inProgress: 0, notStarted: 0 };

  const rawCompleted = (counts.completed / base) * 100;
  const rawInProgress = (counts.inProgress / base) * 100;
  const rawNotStarted = (counts.notStarted / base) * 100;

  const percentages: CoverageCounts = {
    completed: Math.floor(rawCompleted),
    inProgress: Math.floor(rawInProgress),
    notStarted: Math.floor(rawNotStarted),
  };

  const remainder = 100 - percentages.completed - percentages.inProgress - percentages.notStarted;

  const fractions = [
    { key: 'completed' as const, fraction: rawCompleted - percentages.completed },
    { key: 'inProgress' as const, fraction: rawInProgress - percentages.inProgress },
    { key: 'notStarted' as const, fraction: rawNotStarted - percentages.notStarted },
  ].sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < remainder; i++) {
    percentages[fractions[i].key]++;
  }

  return percentages;
}
