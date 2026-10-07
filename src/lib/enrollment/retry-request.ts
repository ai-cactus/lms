import type { EnrollmentStatus } from '@/generated/prisma/enums';
import { TRAINING_ACCESS_PAUSED_MESSAGE } from '@/lib/billing';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

/**
 * Q-35 (ruled 2026-10-07): a learner locked out of a course — every quiz
 * attempt used — may ask their admins for a retake.
 *
 * There is no decline. A request stays pending until an admin grants a retake
 * (`assignRetake` creates the `retakeOf` successor), and the learner may ask
 * again — re-notifying the admins — once {@link RETRY_REQUEST_COOLDOWN_MS} has
 * passed. A request never changes the enrolment's status; it only stamps
 * `retryRequestedAt`.
 *
 * Pure and free of server imports: the learner surfaces read
 * {@link retryRequestUiState} in client components.
 */

export const RETRY_REQUEST_COOLDOWN_MS = 72 * 60 * 60 * 1000;

export type RetryRequestDecision =
  'eligible' | 'already_requested' | 'not_locked' | 'archived' | 'retake_exists' | 'billing_paused';

export interface RetryRequestFacts {
  status: EnrollmentStatus;
  retryRequestedAt: Date | null;
  courseArchived: boolean;
  /** Whether a `retakeOf` successor exists — i.e. the request was already granted. */
  hasRetake: boolean;
  billingActive: boolean;
  now: Date;
}

/** The instant before which an earlier request no longer blocks a new one. */
export function retryRequestCooldownStart(now: Date): Date {
  return new Date(now.getTime() - RETRY_REQUEST_COOLDOWN_MS);
}

function isWithinCooldown(retryRequestedAt: Date | null, now: Date): boolean {
  return (
    retryRequestedAt !== null &&
    retryRequestedAt.getTime() > retryRequestCooldownStart(now).getTime()
  );
}

/**
 * Whether the learner may request a retry now. The checks run in the order a
 * learner can do something about them: a cancelled course and a paused
 * subscription outrank everything, then the enrolment's own state.
 */
export function decideRetryRequest(facts: RetryRequestFacts): RetryRequestDecision {
  if (facts.courseArchived) return 'archived';
  if (!facts.billingActive) return 'billing_paused';
  if (facts.status !== 'locked') return 'not_locked';
  if (facts.hasRetake) return 'retake_exists';
  if (isWithinCooldown(facts.retryRequestedAt, facts.now)) return 'already_requested';
  return 'eligible';
}

export const RETRY_REQUEST_NOT_LOCKED_MESSAGE =
  'You can request a retry only after using all of your quiz attempts.';

export const RETRY_REQUEST_RETAKE_EXISTS_MESSAGE =
  'A retake has already been assigned for this course. You can find it in My Trainings.';

export const RETRY_REQUEST_RATE_LIMITED_MESSAGE =
  'You have sent several retry requests in a short time. Please try again later.';

export const RETRY_REQUEST_MFA_REQUIRED_MESSAGE =
  'Please complete two-factor verification to continue.';

/** The learner-facing reason for each refused decision. */
export function retryRequestRefusalMessage(
  decision: Exclude<RetryRequestDecision, 'eligible' | 'already_requested'>,
): string {
  switch (decision) {
    case 'archived':
      return ARCHIVED_COURSE_LEARNER_MESSAGE;
    case 'billing_paused':
      return TRAINING_ACCESS_PAUSED_MESSAGE;
    case 'not_locked':
      return RETRY_REQUEST_NOT_LOCKED_MESSAGE;
    case 'retake_exists':
      return RETRY_REQUEST_RETAKE_EXISTS_MESSAGE;
  }
}

/**
 * What a learner surface shows for one enrolment:
 * - `available`: locked, no retake yet, and no request inside the cool-down —
 *   offer "Request retry".
 * - `pending`: a request was sent inside the cool-down — show "Retry requested".
 * - `none`: not locked, or a retake already exists — nothing to offer.
 */
export type RetryRequestUiState = 'available' | 'pending' | 'none';

export function retryRequestUiState(input: {
  status: EnrollmentStatus | string;
  retryRequestedAt: Date | string | null | undefined;
  hasRetake?: boolean;
  now?: Date;
}): RetryRequestUiState {
  if (input.status !== 'locked' || input.hasRetake) return 'none';
  const requestedAt = input.retryRequestedAt ? new Date(input.retryRequestedAt) : null;
  if (requestedAt && Number.isNaN(requestedAt.getTime())) return 'available';
  return isWithinCooldown(requestedAt, input.now ?? new Date()) ? 'pending' : 'available';
}
