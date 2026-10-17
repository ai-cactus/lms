/**
 * Immediate Stripe subscription cancellation for the /system permanent
 * organization delete. Unlike the customer-facing cancel (which only sets
 * `cancel_at_period_end`), this ends billing now: no proration credit and no
 * final invoice. The Stripe customer is never touched, so Stripe keeps the
 * billing history.
 *
 * Retrieve-before-act plus idempotency keys make a retry after a partial
 * failure safe: a subscription Stripe no longer has, or has already ended, is
 * reported as `already_cancelled` rather than failing the caller.
 */
import type Stripe from 'stripe';
import { isResourceMissingError } from '@/lib/billing-schedule';
import { logger } from '@/lib/logger';
import { getStripeClient } from '@/lib/stripe';

export type StripeCancelOutcome = 'cancelled' | 'already_cancelled';

const ENDED_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'canceled',
  'incomplete_expired',
]);

/**
 * Cancels the subscription immediately. When a schedule (a pending plan
 * change) manages it, the schedule is cancelled instead, which Stripe applies
 * to its subscription too; cancelling the subscription directly under a
 * schedule is not the documented path.
 *
 * Throws on any Stripe failure, and when no Stripe key is configured (the
 * build-time dummy client must never be mistaken for a real cancel). The
 * caller turns that into a refusal.
 */
export async function cancelStripeSubscriptionNow(
  organizationId: string,
  stripeSubscriptionId: string,
): Promise<StripeCancelOutcome> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  const stripe = getStripeClient();

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  } catch (err) {
    if (!isResourceMissingError(err)) throw err;
    logger.info({
      msg: '[billing] Subscription already gone from Stripe; nothing to cancel',
      orgId: organizationId,
    });
    return 'already_cancelled';
  }

  if (ENDED_STATUSES.has(subscription.status)) {
    logger.info({
      msg: '[billing] Subscription already ended in Stripe; nothing to cancel',
      orgId: organizationId,
      status: subscription.status,
    });
    return 'already_cancelled';
  }

  const scheduleId =
    typeof subscription.schedule === 'string'
      ? subscription.schedule
      : (subscription.schedule?.id ?? null);

  if (scheduleId) {
    await stripe.subscriptionSchedules.cancel(
      scheduleId,
      { invoice_now: false, prorate: false },
      { idempotencyKey: `org-hard-delete-cancel-schedule:${scheduleId}` },
    );
  } else {
    await stripe.subscriptions.cancel(
      stripeSubscriptionId,
      {
        invoice_now: false,
        prorate: false,
        cancellation_details: { comment: 'Organization permanently deleted' },
      },
      { idempotencyKey: `org-hard-delete-cancel:${stripeSubscriptionId}` },
    );
  }

  logger.info({
    msg: '[billing] Subscription cancelled immediately for an organization being permanently deleted',
    orgId: organizationId,
    viaSchedule: scheduleId !== null,
  });
  return 'cancelled';
}
