import type { PlanKey, BillingCycle } from '@/lib/billing-plans';

/**
 * Pure, unit-testable classification of a subscription plan/cycle change.
 *
 * The billing policy (Phase 4, Issue 3) splits a plan change into three cases:
 *  - `no_op`             — target equals the live plan/cycle; nothing to do.
 *  - `scheduled`         — the change takes effect at the current period end
 *                          with NO charge today (same-tier cycle changes, any
 *                          downgrade, and "almost-expired" upgrades).
 *  - `immediate_prorate` — a genuine tier upgrade with ≥ 1 month remaining;
 *                          Stripe prorates and charges the difference now.
 *
 * Intentionally free of Stripe/Prisma dependencies so it can be exercised in
 * isolation and reused by both the checkout and preview routes.
 */

/** Ordinal tier ranking used to derive upgrade/downgrade direction. */
export const PLAN_TIER_ORDER: Record<PlanKey, number> = {
  starter: 1,
  professional: 2,
  enterprise: 3,
};

export type PlanChangeClassification = 'no_op' | 'scheduled' | 'immediate_prorate';

export interface ClassifyPlanChangeInput {
  currentPlanKey: PlanKey;
  currentCycle: BillingCycle;
  targetPlanKey: PlanKey;
  targetCycle: BillingCycle;
  currentPeriodEnd: Date;
  now?: Date;
}

export interface PlanChangeClassificationResult {
  classification: PlanChangeClassification;
  tierDirection: 'same' | 'upgrade' | 'downgrade';
  cycleChanged: boolean;
}

/**
 * Whether strictly less than one calendar month remains before the period ends.
 *
 * Uses calendar-month (`setMonth`) arithmetic, consistent with `pauseEndDate()`
 * in `billing.ts`. An exact one-month boundary counts as "≥ 1 month" (returns
 * false), so an upgrade sitting exactly one month out is prorated immediately.
 */
export function isLessThanOneMonthRemaining(currentPeriodEnd: Date, now: Date): boolean {
  const oneMonthBeforeEnd = new Date(currentPeriodEnd);
  oneMonthBeforeEnd.setMonth(oneMonthBeforeEnd.getMonth() - 1);
  return now.getTime() > oneMonthBeforeEnd.getTime();
}

export function classifyPlanChange(input: ClassifyPlanChangeInput): PlanChangeClassificationResult {
  const now = input.now ?? new Date();
  const tierDelta = PLAN_TIER_ORDER[input.targetPlanKey] - PLAN_TIER_ORDER[input.currentPlanKey];
  const cycleChanged = input.currentCycle !== input.targetCycle;
  const tierDirection = tierDelta === 0 ? 'same' : tierDelta > 0 ? 'upgrade' : 'downgrade';

  // Same tier: only a cycle change matters, and it is always scheduled so the
  // admin is never charged mid-period for a pure cadence switch.
  if (tierDirection === 'same') {
    return {
      classification: cycleChanged ? 'scheduled' : 'no_op',
      tierDirection,
      cycleChanged,
    };
  }

  // Downgrade (either cycle): the tier rule dominates — defer to period end with
  // no refund. This also covers a combined downgrade + cycle change.
  if (tierDirection === 'downgrade') {
    return { classification: 'scheduled', tierDirection, cycleChanged };
  }

  // Upgrade: prorate and charge now, unless the period is almost over — in which
  // case there is little value in charging a tiny proration, so schedule it.
  //
  // INTENDED per product decision (2026-07-17): a MONTHLY subscription's period
  // is exactly one month, so `isLessThanOneMonthRemaining` is true for any moment
  // after the subscription start — meaning a monthly tier upgrade ALWAYS resolves
  // to `scheduled`. That is deliberate: the current monthly tier runs to the end
  // of the month and the higher tier takes effect (and is charged) at renewal,
  // rather than proration mid-month. `immediate_prorate` is therefore reachable
  // only for quarterly/yearly cycles (periods > 1 month). Do NOT "fix" this to
  // force monthly upgrades to charge immediately without re-confirming the policy.
  const classification = isLessThanOneMonthRemaining(input.currentPeriodEnd, now)
    ? 'scheduled'
    : 'immediate_prorate';
  return { classification, tierDirection, cycleChanged };
}

/**
 * The billing-cycle key expressed as a Stripe phase `duration` (interval +
 * count). Pure mapping kept alongside the classifier so the scheduled-change
 * branch of the checkout route can size phase 2 to exactly one billing cycle.
 */
export const CYCLE_DURATION: Record<
  BillingCycle,
  { interval: 'month' | 'year'; intervalCount: number }
> = {
  monthly: { interval: 'month', intervalCount: 1 },
  quarterly: { interval: 'month', intervalCount: 3 },
  yearly: { interval: 'year', intervalCount: 1 },
};
