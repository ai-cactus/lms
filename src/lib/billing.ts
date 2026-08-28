/**
 * Single source of truth for whether an organization currently has active,
 * usable billing.
 *
 * Billing is "active" only when the subscription is `active`/`trialing` AND is
 * not paused. Stripe keeps a paused subscription's status as `active` (it only
 * sets `pause_collection`), so we persist `pausedAt` locally and check it here —
 * otherwise the billing gate would never appear while billing is paused.
 */
export interface BillingSubscriptionLike {
  status?: string | null | undefined;
  /**
   * A pause the admin REQUESTED that has not taken effect yet (see
   * {@link hasPendingPause}). Declared here only so callers can pass a whole
   * subscription row through; it is deliberately never read by
   * {@link hasActiveBilling} or {@link getPauseState}.
   */
  pauseStartsAt?: Date | string | null;
  pausedAt?: Date | string | null;
  pauseEndsAt?: Date | string | null;
}

/**
 * ⛔ `pauseStartsAt` MUST NOT be consulted here. A pause takes effect only at
 * the end of the period the org already paid for (product decision 2026-08-27),
 * so during the pending window billing is still fully active. Because this is
 * the single choke point every access gate funnels through — worker portal,
 * quiz submit, enrollment, course-assign, auditor access — reading
 * `pauseStartsAt` here would revoke access the moment a pause is *scheduled*,
 * which is exactly the bug the separate column exists to prevent.
 */
export function hasActiveBilling(
  subscription: BillingSubscriptionLike | null | undefined,
): boolean {
  if (!subscription) return false;
  if (subscription.pausedAt) return false;
  return subscription.status === 'active' || subscription.status === 'trialing';
}

/**
 * Whether a pause has been requested but has not taken effect yet.
 *
 * UI ONLY — for rendering the "your subscription will pause on …" notice and its
 * cancel action. It must never be folded into {@link hasActiveBilling} or
 * {@link getPauseState}: a pending pause grants no less access than no pause at
 * all, and both of those functions gate access.
 */
export function hasPendingPause(subscription: BillingSubscriptionLike | null | undefined): boolean {
  return !!subscription?.pauseStartsAt && !subscription.pausedAt;
}

/**
 * The message every course-assignment path throws when {@link hasActiveBilling}
 * rejects the org. Shared so callers that need to branch on it — the
 * multi-course staff assignment aborts its loop rather than failing each course
 * in turn — compare against one literal instead of their own copy.
 */
export const BILLING_GATE_ASSIGN_MESSAGE =
  'Your organization needs an active subscription to assign courses.';

/** The longest a subscription may stay paused before a continue/cancel decision. */
export const MAX_PAUSE_MONTHS = 3;

export type PauseState = 'none' | 'paused' | 'expired';

/**
 * Where a subscription sits in the pause lifecycle:
 *  - `none`    — not paused
 *  - `paused`  — within the chosen pause window; admin can continue any time
 *  - `expired` — the pause window has elapsed; admin must continue or cancel
 *
 * A PENDING pause reports `none`, on purpose — see {@link hasPendingPause}.
 * `pauseStartsAt` must not be read here for the same reason it must not be read
 * in {@link hasActiveBilling}.
 */
export function getPauseState(
  subscription: BillingSubscriptionLike | null | undefined,
  now: Date = new Date(),
): PauseState {
  if (!subscription?.pausedAt) return 'none';
  if (subscription.pauseEndsAt && new Date(subscription.pauseEndsAt) <= now) {
    return 'expired';
  }
  return 'paused';
}

/** Add whole months to a date, clamped to the {@link MAX_PAUSE_MONTHS} limit. */
export function pauseEndDate(start: Date, months: number): Date {
  const clamped = Math.min(Math.max(Math.round(months), 1), MAX_PAUSE_MONTHS);
  const end = new Date(start);
  end.setMonth(end.getMonth() + clamped);
  return end;
}
