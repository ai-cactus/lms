import type { PlanKey, BillingCycle } from '@/lib/billing-plans';

/**
 * Pure, unit-testable classification of a subscription plan/cycle change.
 *
 * The billing policy (Phase 4, Issue 3) splits a plan change into three cases:
 *  - `no_op`             — target equals the live plan/cycle; nothing to do.
 *  - `scheduled`         — the change takes effect at the current period end
 *                          with NO charge today (same-tier cycle changes and
 *                          any downgrade).
 *  - `immediate_prorate` — any tier upgrade; Stripe prorates and charges the
 *                          difference now (product decision 2026-08-27).
 *
 * Intentionally free of Stripe/Prisma dependencies so it can be exercised in
 * isolation and reused by both the checkout and preview routes.
 */

/** Ordinal tier ranking used to derive upgrade/downgrade direction. */
export const PLAN_TIER_ORDER: Record<PlanKey, number> = {
  starter: 1,
  growth: 2,
  pro: 3,
  enterprise: 4,
};

export type PlanChangeClassification = 'no_op' | 'scheduled' | 'immediate_prorate';

export interface ClassifyPlanChangeInput {
  currentPlanKey: PlanKey;
  currentCycle: BillingCycle;
  targetPlanKey: PlanKey;
  targetCycle: BillingCycle;
  /**
   * Subscription state the classification is made against. Not consulted since
   * the 2026-08-27 upgrade policy removed the last time-based rule; kept on the
   * input so callers keep passing the full context a future date-sensitive rule
   * would need, rather than the signature churning back and forth.
   */
  currentPeriodEnd: Date;
  /** Clock override for the same reason as {@link currentPeriodEnd}. */
  now?: Date;
}

export interface PlanChangeClassificationResult {
  classification: PlanChangeClassification;
  tierDirection: 'same' | 'upgrade' | 'downgrade';
  cycleChanged: boolean;
}

export function classifyPlanChange(input: ClassifyPlanChangeInput): PlanChangeClassificationResult {
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

  // Upgrade: always prorate and charge now, on every cycle and no matter how
  // little of the period is left.
  //
  // Product decision (2026-08-27), REVERSING the 2026-07-17 policy: upgrades used
  // to be deferred to period end whenever less than one calendar month remained,
  // which — because a monthly period IS one month — silently made every monthly
  // upgrade `scheduled`. An admin who upgraded expecting more capacity today did
  // not get it. The upgrade is now honoured immediately; Stripe prorates the
  // difference and the charge either succeeds or the change is rejected outright
  // (see the checkout route's `error_if_incomplete` handling).
  //
  // Downgrades and same-tier cycle changes are unaffected and still defer to
  // period end — only the upgrade direction charges today.
  return { classification: 'immediate_prorate', tierDirection, cycleChanged };
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
