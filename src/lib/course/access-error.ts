/**
 * Why a course-detail read was refused.
 *
 * The two dashboard course pages try `getCourseById` and, on refusal, retry
 * through `getCourseForOrgView` (the global-catalog browse path). A bare
 * `catch` made that retry indiscriminate: a database outage, a missing session
 * or an authorization denial all became "try the weaker door, then 404". A
 * denial must stay a denial, and an infrastructure failure must stay a failure.
 *
 * The distinction travels as a typed error rather than a message, because
 * Next.js redacts server error messages in production — matching on text would
 * silently stop working in the only environment that matters.
 *
 * `notFound` and `forbidden` deliberately share the SAME user-facing message.
 * Telling an unauthorized caller that the course exists is itself a disclosure;
 * the reason is for our own control flow, never for the response body.
 */
export type CourseAccessReason = 'unauthenticated' | 'notFound' | 'forbidden';

const REASON_MESSAGE: Record<CourseAccessReason, string> = {
  unauthenticated: 'Unauthorized',
  notFound: 'Course not found',
  forbidden: 'Course not found',
};

export class CourseAccessError extends Error {
  readonly reason: CourseAccessReason;

  constructor(reason: CourseAccessReason) {
    super(REASON_MESSAGE[reason]);
    this.name = 'CourseAccessError';
    this.reason = reason;
  }
}

export function isCourseAccessError(error: unknown): error is CourseAccessError {
  return error instanceof CourseAccessError;
}
