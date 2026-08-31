/**
 * Picks the ONE enrollment a learner-facing course list should render per course.
 *
 * A retake or a renewal is a brand new `Enrollment` row (`assignRetake` creates
 * one with `retakeOf` set while the failed row stays `locked`), so a course
 * routinely has several rows for the same learner. The learn player and
 * `getLearnPayload` both resolve that ambiguity with
 * `orderBy: { startedAt: 'desc' }` — newest wins. The learner dashboard used to
 * prefer the completed/attested row instead, so a worker who had been assigned a
 * retake still saw the old "Attested" row and had no way to reach the retake the
 * player was already operating on.
 */

/**
 * Non-terminal statuses — the learner still has something to do on this row.
 * `locked` counts: the learner cannot act, but an admin-assigned retake is the
 * pending outcome, so the row must stay visible rather than be masked by an
 * older completed one.
 */
const ACTIONABLE_STATUSES: ReadonlySet<string> = new Set([
  'enrolled',
  'assigned',
  'in_progress',
  'lessons_complete',
  'locked',
]);

export function isActionableEnrollmentStatus(status: string): boolean {
  return ACTIONABLE_STATUSES.has(status);
}

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
 * One enrollment per course: the newest actionable one, falling back to the
 * newest terminal one (completed / attested / …) only when the learner has
 * nothing left to act on. Courses keep the order in which they first appear in
 * `enrollments`, and a `startedAt` tie keeps the earlier row so the caller's
 * ordering stays authoritative.
 */
export function selectDisplayEnrollments<T extends DisplayableEnrollment>(
  enrollments: readonly T[],
): T[] {
  const actionable = new Map<string, T>();
  const terminal = new Map<string, T>();
  const courseOrder: string[] = [];

  for (const enrollment of enrollments) {
    const { courseId } = enrollment;
    if (!actionable.has(courseId) && !terminal.has(courseId)) {
      courseOrder.push(courseId);
    }

    const bucket = isActionableEnrollmentStatus(enrollment.status) ? actionable : terminal;
    const incumbent = bucket.get(courseId);
    if (!incumbent || startedAtMs(enrollment) > startedAtMs(incumbent)) {
      bucket.set(courseId, enrollment);
    }
  }

  return courseOrder
    .map((courseId) => actionable.get(courseId) ?? terminal.get(courseId))
    .filter((enrollment): enrollment is T => enrollment !== undefined);
}
