/**
 * BUG-60: copy for the learner actions' authorization refusals. They are
 * RETURNED as `refusedReason`, never thrown: production redacts a thrown Server
 * Action message to React error #441, so the learner saw "something went
 * wrong" with nothing to act on.
 *
 * A missing enrolment and one owned by someone else share one message on
 * purpose, so the refusal cannot be used to probe which enrolment ids exist.
 */

export const LEARNER_SIGNED_OUT_MESSAGE =
  'Your session has ended. Please sign in again to continue.';

export const LEARNER_ENROLLMENT_UNAVAILABLE_MESSAGE =
  'We couldn’t find this training on the account you’re signed in with. Sign in as the learner it was assigned to and try again.';
