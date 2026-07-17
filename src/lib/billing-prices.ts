import 'server-only';

import { unstable_cache } from 'next/cache';
import { getStripeClient } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { BILLING_PLANS, type BillingCycle, type PlanKey } from '@/lib/billing-plans';

/**
 * Stripe-derived price information for a single plan/cycle price.
 * `effectiveMonthlyCents` normalises the per-cycle charge to a monthly figure
 * so plan cards can present a consistent "$X/mo" regardless of billing cycle.
 */
export interface StripePriceInfo {
  unitAmountCents: number;
  currency: string;
  interval: 'month' | 'year';
  intervalCount: number;
  effectiveMonthlyCents: number;
}

export type PlanPriceMap = Record<PlanKey, Partial<Record<BillingCycle, StripePriceInfo>>>;

interface PriceJob {
  planKey: PlanKey;
  cycle: BillingCycle;
  priceId: string;
}

/**
 * Fetches live plan prices directly from Stripe — the single source of truth.
 *
 * Never throws: any failure (missing key, network error, unexpected price
 * shape) degrades to the affected plan/cycle being absent from the map so the
 * UI can fall back to "Price unavailable" without breaking the page.
 *
 * Exported unwrapped (uncached) for unit testing; production reads go through
 * the cached {@link getPlanPrices}.
 */
export async function fetchPlanPricesUncached(): Promise<PlanPriceMap> {
  const result = {} as PlanPriceMap;
  for (const plan of BILLING_PLANS) {
    result[plan.key] = {};
  }

  // Check the env var directly rather than calling getStripeClient(), which
  // throws in production when the key is missing — here a missing key should
  // degrade gracefully to the all-empty map (and skip an unnecessary network
  // call) rather than crash the billing page.
  if (!process.env.STRIPE_SECRET_KEY) {
    logger.warn({ msg: '[billing] STRIPE_SECRET_KEY unset — plan prices unavailable' });
    return result;
  }

  const jobs: PriceJob[] = [];
  for (const plan of BILLING_PLANS) {
    for (const cycle of Object.keys(plan.priceId) as BillingCycle[]) {
      const priceId = plan.priceId[cycle];
      if (priceId) {
        jobs.push({ planKey: plan.key, cycle, priceId });
      }
    }
  }

  const stripe = getStripeClient();
  const settled = await Promise.allSettled(jobs.map((job) => stripe.prices.retrieve(job.priceId)));

  settled.forEach((outcome, index) => {
    const { planKey, cycle, priceId } = jobs[index];

    if (outcome.status === 'rejected') {
      logger.error({
        msg: '[billing] Failed to retrieve Stripe price',
        err: outcome.reason,
        planKey,
        cycle,
        priceId,
      });
      return;
    }

    const price = outcome.value;
    const { unit_amount: unitAmount, currency, recurring } = price;

    if (
      unitAmount == null ||
      recurring == null ||
      (recurring.interval !== 'month' && recurring.interval !== 'year')
    ) {
      logger.warn({
        msg: '[billing] Unexpected Stripe price shape — skipping',
        planKey,
        cycle,
        priceId,
      });
      return;
    }

    const intervalCount = recurring.interval_count;
    const months = recurring.interval === 'year' ? 12 * intervalCount : intervalCount;

    result[planKey][cycle] = {
      unitAmountCents: unitAmount,
      currency,
      interval: recurring.interval,
      intervalCount,
      effectiveMonthlyCents: Math.round(unitAmount / months),
    };
  });

  return result;
}

/**
 * Cached accessor for live plan prices. Cached for 1 hour and tagged
 * `billing-prices` so a future price change can invalidate it via
 * `revalidateTag('billing-prices')`.
 */
export const getPlanPrices = unstable_cache(fetchPlanPricesUncached, ['billing-plan-prices'], {
  revalidate: 3600,
  tags: ['billing-prices'],
});
