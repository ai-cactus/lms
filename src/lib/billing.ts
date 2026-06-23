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
  pausedAt?: Date | string | null;
  pauseEndsAt?: Date | string | null;
}

export function hasActiveBilling(
  subscription: BillingSubscriptionLike | null | undefined,
): boolean {
  if (!subscription) return false;
  if (subscription.pausedAt) return false;
  return subscription.status === 'active' || subscription.status === 'trialing';
}

/** The longest a subscription may stay paused before a continue/cancel decision. */
export const MAX_PAUSE_MONTHS = 3;

export type PauseState = 'none' | 'paused' | 'expired';

/**
 * Where a subscription sits in the pause lifecycle:
 *  - `none`    — not paused
 *  - `paused`  — within the chosen pause window; admin can continue any time
 *  - `expired` — the pause window has elapsed; admin must continue or cancel
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
