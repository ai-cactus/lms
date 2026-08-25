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
 * The schedule's live status, or `null` when Stripe no longer has it at all.
 * Only `resource_missing` is folded into `null`; every other failure
 * propagates.
 */
async function retrieveScheduleStatus(
  stripe: Stripe,
  stripeScheduleId: string,
): Promise<Stripe.SubscriptionSchedule.Status | null> {
  try {
    const schedule = await stripe.subscriptionSchedules.retrieve(stripeScheduleId);
    return schedule.status;
  } catch (err) {
    if (isResourceMissingError(err)) return null;
    throw err;
  }
}

/** Stripe accepts `release` only while the schedule is `not_started` or `active`. */
function isReleasable(status: Stripe.SubscriptionSchedule.Status | null): boolean {
  return status !== null && RELEASABLE_STATUSES.has(status);
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
 * The same tolerance covers the release call itself. Two concurrent requests
 * (cancel + resume, say) can both read `active` and both attempt the release;
 * the loser must not fail a mutation that in fact reached its desired end
 * state. Stripe publishes no error code for "already released" — `code` is
 * documented as nullable and populated only "for some errors", and the
 * error-codes table has no subscription-schedule entry — so rather than match
 * an undocumented message string, a failed release re-reads the schedule and
 * tolerates the failure only when Stripe confirms it is genuinely no longer
 * releasable.
 *
 * Any other failure propagates and the local columns are left untouched: a
 * change we could not confirm is gone on Stripe must not be resolved locally.
 *
 * @returns `released: true` only when this call's own `release` request was
 * accepted by Stripe. A release lost to a concurrent request reports `false`,
 * as does a release whose response never came back even though Stripe applied
 * it — the flag records what this request observed, not who ended the
 * schedule, and it is surfaced in the caller's audit metadata on that basis.
 */
export async function releasePendingSchedule(
  organizationId: string,
  stripeScheduleId: string,
): Promise<{ released: boolean }> {
  const stripe = getStripeClient();

  const liveStatus = await retrieveScheduleStatus(stripe, stripeScheduleId);

  let released = false;
  if (isReleasable(liveStatus)) {
    try {
      await stripe.subscriptionSchedules.release(stripeScheduleId);
      released = true;
    } catch (releaseError) {
      let statusAfterFailure: Stripe.SubscriptionSchedule.Status | null;
      try {
        statusAfterFailure = await retrieveScheduleStatus(stripe, stripeScheduleId);
      } catch {
        throw releaseError;
      }
      // Still releasable means the schedule is untouched, so the release
      // genuinely failed (auth, network, rate limit, unexpected fault).
      if (isReleasable(statusAfterFailure)) throw releaseError;
    }
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
