/**
 * Founder rulings Q-04/Q-05/Q-06 (2026-09-23): archiving a course CANCELS it
 * for learners. Archiving is never blocked by live enrolments, but from the
 * moment it happens every learner action stops — opening the course, starting
 * or submitting a quiz, saving quiz answers, advancing progress, attesting and
 * retaking — and no further reminders are produced for it. Certificates already
 * earned are retained: nothing here revokes or hides one.
 *
 * The copy lives in its own module, free of Prisma imports, so every refusal
 * site says the same thing and the message can be shared with client code
 * without dragging the server graph along.
 */

/** Shown to a learner whose course was archived out from under them. */
export const ARCHIVED_COURSE_LEARNER_MESSAGE =
  'This course has been cancelled by your organization and is no longer available.';

/** Shown to an admin acting on someone else's enrollment in an archived course. */
export const ARCHIVED_COURSE_ADMIN_MESSAGE =
  'This course has been archived, so its training can no longer be retaken or continued.';

/**
 * Machine-readable code returned in the quiz start route's `error` field, which
 * pairs a code there with human copy in `message` (the submit route puts the
 * human text in `error` instead — the two shapes differ by design).
 */
export const ARCHIVED_COURSE_ERROR_CODE = 'COURSE_ARCHIVED';
