/**
 * Picks the ONE enrollment a learner-facing course list should render per course.
 *
 * A retake or a renewal is a brand new `Enrollment` row (`assignRetake` creates
 * one with `retakeOf` set while the failed row stays `locked`), so a course
 * routinely has several rows for the same learner. The rule is simply **newest
 * by `startedAt`**, which is exactly what the learn player and `getLearnPayload`
 * already do (`orderBy: { startedAt: 'desc' }`). The two views must agree: any
 * other rule shows the learner a row the player is not operating on.
 *
 * Two bugs came from not doing this, and the second is why the rule is now a
 * plain sort rather than anything cleverer:
 *
 *   1. `/worker` and `/worker/trainings` used to end their dedupe with
 *      `const picked = completed ?? e`, so a completed/attested row always beat
 *      the newest one and an admin-assigned retake was invisible.
 *   2. The first fix replaced that with "newest ACTIONABLE row, falling back to
 *      terminal" — which inverted the bug instead of removing it. `locked` is
 *      actionable, so once a learner passed and attested a retake they had an
 *      old `locked` row (actionable) and a new `attested` row (terminal), and
 *      the old one won. The worker's own list still read "Locked" after they
 *      had genuinely completed and signed.
 *
 * Both cases are a tier beating recency. Recency alone resolves both, because
 * the newer row is the one the learner is actually on.
 */

/** The minimum an enrollment must expose to be ranked. */
export interface DisplayableEnrollment {
  courseId: string;
  status: string;
  startedAt: Date | string | null;
}

function startedAtMs(enrollment: DisplayableEnrollment): number {
  if (!enrollment.startedAt) return Number.NEGATIVE_INFINITY;
  const ms = new Date(enrollment.startedAt).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * One enrollment per course: the newest by `startedAt`. Courses keep the order
 * in which they first appear in `enrollments`, and a tie keeps the earlier row
 * so the caller's ordering stays authoritative.
 */
export function selectDisplayEnrollments<T extends DisplayableEnrollment>(
  enrollments: readonly T[],
): T[] {
  const newest = new Map<string, T>();
  const courseOrder: string[] = [];

  for (const enrollment of enrollments) {
    const { courseId } = enrollment;
    const incumbent = newest.get(courseId);

    if (!incumbent) {
      courseOrder.push(courseId);
      newest.set(courseId, enrollment);
      continue;
    }

    if (startedAtMs(enrollment) > startedAtMs(incumbent)) {
      newest.set(courseId, enrollment);
    }
  }

  return courseOrder
    .map((courseId) => newest.get(courseId))
    .filter((enrollment): enrollment is T => enrollment !== undefined);
}
