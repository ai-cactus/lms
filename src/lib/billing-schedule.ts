/**
 * Stripe subscription-schedule teardown, shared by every billing route that
 * needs a pending plan change out of the way before it can mutate the
 * subscription itself.
 *
 * Stripe refuses cancellation-behaviour updates on a subscription attached to
 * a schedule ("The subscription is managed by the subscription schedule ...,
 * and updating any cancelation behavior directly is not allowed"), so cancel /
 * resume / reactivate release the pending schedule first instead of blocking
 * the user behind a 409.
 *
 * Lives outside billing.ts / billing-plan-change.ts on purpose: those are
 * documented as pure and IO-free, and this module talks to Stripe and the DB.
 */
import type Stripe from 'stripe';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { logger } from '@/lib/logger';

/** The only schedule states Stripe will accept a `release` call for. */
const RELEASABLE_STATUSES: ReadonlySet<Stripe.SubscriptionSchedule.Status> = new Set([
  'not_started',
  'active',
]);

/**
 * Duck-typed rather than `instanceof Stripe.errors.*`: the Stripe error class
 * identity is not guaranteed across module instances, and `code` is the stable
 * public contract for "this object no longer exists".
 */
function isResourceMissingError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'resource_missing'
  );
}

/**
 * Releases the organization's pending subscription schedule and clears the
 * local `scheduled*` mirror.
 *
 * Read-before-act: the live schedule is retrieved first and `release` is only
 * called while Stripe still considers it releasable. A schedule that already
 * ended (released/canceled/completed) or that Stripe no longer knows about is
 * treated as already gone — the local columns are still cleared, which is what
 * repairs a stale mirror instead of failing the caller's request.
 *
 * Any other failure propagates and the local columns are left untouched: a
 * change we could not confirm is gone on Stripe must not be resolved locally.
 *
 * @returns `released: true` only when a `release` call was actually made.
 */
export async function releasePendingSchedule(
  organizationId: string,
  stripeScheduleId: string,
): Promise<{ released: boolean }> {
  const stripe = getStripeClient();

  let liveStatus: Stripe.SubscriptionSchedule.Status | null = null;
  try {
    const schedule = await stripe.subscriptionSchedules.retrieve(stripeScheduleId);
    liveStatus = schedule.status;
  } catch (err) {
    if (!isResourceMissingError(err)) throw err;
  }

  const released = liveStatus !== null && RELEASABLE_STATUSES.has(liveStatus);
  if (released) {
    await stripe.subscriptionSchedules.release(stripeScheduleId);
  }

  await prisma.subscription.update({
    where: { organizationId },
    data: {
      scheduledPlan: null,
      scheduledBillingCycle: null,
      scheduledPriceId: null,
      scheduledEffectiveAt: null,
      stripeScheduleId: null,
    },
  });

  logger.info({
    msg: '[billing] Cleared pending subscription schedule',
    organizationId,
    released,
    scheduleStatus: liveStatus,
  });

  return { released };
}
