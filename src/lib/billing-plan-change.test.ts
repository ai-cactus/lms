/**
 * Unit tests for src/lib/billing-plan-change.ts — the pure classifier behind
 * the Phase 4 / Issue 3 plan-change + proration policy. This is the
 * highest-value target in the feature: every other route (checkout, preview,
 * webhook carry-forward) defers its charge-vs-schedule decision to
 * `classifyPlanChange`, so a wrong verdict here silently mis-bills every
 * caller downstream.
 *
 * All dates are passed explicitly via the `now` override — never real
 * `Date.now()` — so these tests are fully deterministic regardless of when
 * they run. "Today" for the policy (per the Phase 4 spec) is 2026-07-17.
 *
 * UPGRADE POLICY (product decision, 2026-08-27 — REVERSES 2026-07-17): every
 * tier upgrade now classifies as `immediate_prorate`, on every cycle and at
 * every point in the period. The previous policy deferred an upgrade to period
 * end whenever less than one calendar month remained, which — because a monthly
 * period IS exactly one month — silently made every monthly upgrade
 * `scheduled`. The upgrade branch is therefore time-independent, and the
 * upgrade tests below assert that across cycles and across the whole period.
 *
 * Upgrade tests still derive `currentPeriodEnd` from a realistic subscription
 * start via `periodEndFor`, so no test asserts against a period end that could
 * not occur for the cycle attached to it — the classification must not depend
 * on that pair, and pinning realistic pairs is what proves it.
 *
 * Downgrades and same-tier cycle changes are unchanged: both still resolve to
 * `scheduled` (or `no_op`).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyPlanChange,
  PLAN_TIER_ORDER,
  CYCLE_DURATION,
  type ClassifyPlanChangeInput,
} from './billing-plan-change';
import type { PlanKey, BillingCycle } from './billing-plans';

const NOW = new Date('2026-07-17T12:00:00Z');

/** A realistic subscription start instant, used as the anchor for `periodEndFor`. */
const SUBSCRIPTION_START = new Date('2026-07-01T00:00:00Z');

/**
 * Derives a realistic `currentPeriodEnd` from a subscription start and its
 * billing cycle, using the same calendar-month (`setMonth`) arithmetic as
 * the product code (see `pauseEndDate()` in billing.ts). This keeps every
 * upgrade test's `now`/`currentPeriodEnd` pair tied to a cycle that could
 * actually occur, instead of a hand-picked date.
 */
function periodEndFor(start: Date, cycle: BillingCycle): Date {
  const end = new Date(start);
  const months = cycle === 'yearly' ? 12 : cycle === 'quarterly' ? 3 : 1;
  end.setMonth(end.getMonth() + months);
  return end;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function input(overrides: Partial<ClassifyPlanChangeInput> = {}): ClassifyPlanChangeInput {
  return {
    currentPlanKey: 'starter',
    currentCycle: 'monthly',
    targetPlanKey: 'starter',
    targetCycle: 'monthly',
    // Arbitrary but harmless default: only used by no_op / same-tier-cycle /
    // downgrade tests below, all of which are correct regardless of time
    // remaining and don't need cycle-consistency with this date.
    currentPeriodEnd: new Date('2026-09-17T12:00:00Z'),
    now: NOW,
    ...overrides,
  };
}

// ── PLAN_TIER_ORDER ──────────────────────────────────────────────────────────

describe('PLAN_TIER_ORDER', () => {
  it('ranks starter < growth < pro < enterprise', () => {
    expect(PLAN_TIER_ORDER.starter).toBe(1);
    expect(PLAN_TIER_ORDER.growth).toBe(2);
    expect(PLAN_TIER_ORDER.pro).toBe(3);
    expect(PLAN_TIER_ORDER.enterprise).toBe(4);
    expect(PLAN_TIER_ORDER.starter).toBeLessThan(PLAN_TIER_ORDER.growth);
    expect(PLAN_TIER_ORDER.growth).toBeLessThan(PLAN_TIER_ORDER.pro);
    expect(PLAN_TIER_ORDER.pro).toBeLessThan(PLAN_TIER_ORDER.enterprise);
  });
});

// ── CYCLE_DURATION ───────────────────────────────────────────────────────────

describe('CYCLE_DURATION', () => {
  it('maps monthly to a 1-month Stripe phase duration', () => {
    expect(CYCLE_DURATION.monthly).toEqual({ interval: 'month', intervalCount: 1 });
  });

  it('maps quarterly to a 3-month Stripe phase duration', () => {
    expect(CYCLE_DURATION.quarterly).toEqual({ interval: 'month', intervalCount: 3 });
  });

  it('maps yearly to a 1-year Stripe phase duration', () => {
    expect(CYCLE_DURATION.yearly).toEqual({ interval: 'year', intervalCount: 1 });
  });
});

// ── classifyPlanChange — same tier ──────────────────────────────────────────

describe('classifyPlanChange — same tier, same cycle (no_op)', () => {
  it.each<PlanKey>(['starter', 'growth', 'pro', 'enterprise'])(
    'is a no_op for %s with an unchanged cycle',
    (plan) => {
      const result = classifyPlanChange(
        input({
          currentPlanKey: plan,
          targetPlanKey: plan,
          currentCycle: 'yearly',
          targetCycle: 'yearly',
        }),
      );
      expect(result).toEqual({
        classification: 'no_op',
        tierDirection: 'same',
        cycleChanged: false,
      });
    },
  );

  it('is a no_op regardless of how little time remains in the period', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'growth',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
        currentPeriodEnd: new Date('2026-07-18T12:00:00Z'), // 1 day left
      }),
    );
    expect(result.classification).toBe('no_op');
  });
});

describe('classifyPlanChange — same tier, cycle change (scheduled)', () => {
  it('schedules a cycle upgrade (monthly -> yearly) with no charge today', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'starter',
        currentCycle: 'monthly',
        targetCycle: 'yearly',
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'same',
      cycleChanged: true,
    });
  });

  it('schedules a cycle downgrade (yearly -> monthly)', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'growth',
        currentCycle: 'yearly',
        targetCycle: 'monthly',
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'same',
      cycleChanged: true,
    });
  });

  it('schedules a cycle change to quarterly', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'starter',
        currentCycle: 'monthly',
        targetCycle: 'quarterly',
      }),
    );
    expect(result.classification).toBe('scheduled');
  });

  it('schedules a same-tier cycle change even with an entire year remaining (never charges today)', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'starter',
        currentCycle: 'monthly',
        targetCycle: 'yearly',
        currentPeriodEnd: new Date('2027-07-17T12:00:00Z'),
      }),
    );
    expect(result.classification).toBe('scheduled');
  });
});

// ── classifyPlanChange — downgrades (always scheduled) ──────────────────────

describe('classifyPlanChange — tier downgrade (always scheduled, regardless of time remaining)', () => {
  it('schedules growth -> starter with the same cycle', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'starter',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'downgrade',
      cycleChanged: false,
    });
  });

  it('schedules growth -> starter with LOTS of time remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'starter',
        currentPeriodEnd: new Date('2027-07-17T12:00:00Z'),
      }),
    );
    expect(result.classification).toBe('scheduled');
  });

  it('schedules growth -> starter with almost no time remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'starter',
        currentPeriodEnd: new Date('2026-07-18T12:00:00Z'), // 1 day left
      }),
    );
    expect(result.classification).toBe('scheduled');
  });

  it('schedules enterprise -> growth (downgrade from the top tier)', () => {
    const result = classifyPlanChange(
      input({ currentPlanKey: 'enterprise', targetPlanKey: 'growth' }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'downgrade',
      cycleChanged: false,
    });
  });

  it('schedules a combined downgrade + cycle change — tier dominates over the cycle dimension', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'starter',
        currentCycle: 'monthly',
        targetCycle: 'yearly',
        currentPeriodEnd: new Date('2027-07-17T12:00:00Z'), // plenty of time — would be
        // immediate_prorate if this were an upgrade, but downgrade always wins.
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'downgrade',
      cycleChanged: true,
    });
  });
});

// ── classifyPlanChange — `pro` tier (new 4th tier, inserted between growth
// and enterprise) — upgrade/downgrade classification in both directions ────

describe('classifyPlanChange — pro tier transitions', () => {
  it('classifies growth -> pro as an upgrade', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'pro',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
      }),
    );
    expect(result.tierDirection).toBe('upgrade');
  });

  it('classifies pro -> growth as a downgrade, always scheduled regardless of time remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'pro',
        targetPlanKey: 'growth',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
        currentPeriodEnd: new Date('2027-07-17T12:00:00Z'), // lots of time — irrelevant for downgrades
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'downgrade',
      cycleChanged: false,
    });
  });

  it('classifies pro -> starter as a downgrade (skips two tiers, still scheduled)', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'pro',
        targetPlanKey: 'starter',
        currentCycle: 'yearly',
        targetCycle: 'yearly',
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'downgrade',
      cycleChanged: false,
    });
  });

  it('classifies pro -> enterprise as an upgrade', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'pro',
        targetPlanKey: 'enterprise',
        currentCycle: 'yearly',
        targetCycle: 'yearly',
      }),
    );
    expect(result.tierDirection).toBe('upgrade');
  });

  it('classifies enterprise -> pro as a downgrade', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'enterprise',
        targetPlanKey: 'pro',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'downgrade',
      cycleChanged: false,
    });
  });

  it('is a no_op for pro with an unchanged cycle', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'pro',
        targetPlanKey: 'pro',
        currentCycle: 'yearly',
        targetCycle: 'yearly',
      }),
    );
    expect(result).toEqual({
      classification: 'no_op',
      tierDirection: 'same',
      cycleChanged: false,
    });
  });

  it('charges immediately for a starter -> pro monthly upgrade (2026-08-27 policy)', () => {
    const proMonthlyPeriodEnd = periodEndFor(SUBSCRIPTION_START, 'monthly');
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'pro',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
        currentPeriodEnd: proMonthlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 3),
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });

  it('charges immediately for a growth -> pro yearly upgrade early in the period', () => {
    const proYearlyPeriodEnd = periodEndFor(SUBSCRIPTION_START, 'yearly');
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'pro',
        currentCycle: 'yearly',
        targetCycle: 'yearly',
        currentPeriodEnd: proYearlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 3),
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });
});

// ── classifyPlanChange — MONTHLY tier upgrades (regression guard) ──────────
//
// Monthly is the cycle the 2026-07-17 policy silently swallowed: its period is
// exactly one calendar month, so the old "< 1 month remaining" rule matched
// every instant after the period start and no monthly upgrade could ever
// charge. These cases lock in the 2026-08-27 reversal.

describe('classifyPlanChange — monthly tier upgrade always charges immediately (product decision 2026-08-27, reversing 2026-07-17)', () => {
  const monthlyPeriodEnd = periodEndFor(SUBSCRIPTION_START, 'monthly'); // 2026-08-01T00:00:00Z

  it.each<[string, Date]>([
    ['at the period start itself', SUBSCRIPTION_START],
    ['1ms after period start', new Date(SUBSCRIPTION_START.getTime() + 1)],
    ['1 second after period start', new Date(SUBSCRIPTION_START.getTime() + 1000)],
    ['3 days into the period', addDays(SUBSCRIPTION_START, 3)],
    ['20 days into the period (past the midpoint)', addDays(SUBSCRIPTION_START, 20)],
    ['on the final day of the period', addDays(SUBSCRIPTION_START, 30)],
  ])('prorates starter -> growth (monthly) at %s — never deferred to renewal', (_label, now) => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'growth',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
        currentPeriodEnd: monthlyPeriodEnd,
        now,
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });

  it('prorates a monthly upgrade that is ALSO a cycle change to yearly', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'growth',
        currentCycle: 'monthly',
        targetCycle: 'yearly',
        currentPeriodEnd: monthlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 3),
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: true,
    });
  });

  it('prorates enterprise-bound monthly upgrades too (growth -> enterprise, monthly)', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'enterprise',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
        currentPeriodEnd: monthlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 10),
      }),
    );
    expect(result.classification).toBe('immediate_prorate');
  });
});

// ── classifyPlanChange — QUARTERLY tier upgrades ────────────────────────────

describe('classifyPlanChange — quarterly tier upgrade (immediate_prorate throughout the period)', () => {
  const quarterlyPeriodEnd = periodEndFor(SUBSCRIPTION_START, 'quarterly'); // 2026-10-01T00:00:00Z

  it('charges immediately for starter -> growth (quarterly) early in the period, ~3 months remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'growth',
        currentCycle: 'quarterly',
        targetCycle: 'quarterly',
        currentPeriodEnd: quarterlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 3),
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });

  it('charges immediately for a combined quarterly upgrade + cycle change (starter/quarterly -> growth/monthly), ~3 months remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'growth',
        currentCycle: 'quarterly',
        targetCycle: 'monthly',
        currentPeriodEnd: quarterlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 3),
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: true,
    });
  });

  it('charges immediately two months into the 3-month period', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'growth',
        currentCycle: 'quarterly',
        targetCycle: 'quarterly',
        currentPeriodEnd: quarterlyPeriodEnd,
        now: new Date('2026-09-01T00:00:00Z'),
      }),
    );
    expect(result.classification).toBe('immediate_prorate');
  });

  it('charges immediately for starter -> growth (quarterly) inside the final month too', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'growth',
        currentCycle: 'quarterly',
        targetCycle: 'quarterly',
        currentPeriodEnd: quarterlyPeriodEnd,
        now: new Date('2026-09-05T00:00:00Z'), // 2 months + 4 days elapsed — < 1 month left
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });
});

// ── classifyPlanChange — YEARLY tier upgrades ───────────────────────────────

describe('classifyPlanChange — yearly tier upgrade (immediate_prorate throughout the period)', () => {
  const yearlyPeriodEnd = periodEndFor(SUBSCRIPTION_START, 'yearly'); // 2027-07-01T00:00:00Z

  it('charges immediately for growth -> enterprise (yearly) early in the period, ~12 months remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'enterprise',
        currentCycle: 'yearly',
        targetCycle: 'yearly',
        currentPeriodEnd: yearlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 3),
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });

  it('charges immediately for growth -> enterprise (yearly) inside the final month too', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'enterprise',
        currentCycle: 'yearly',
        targetCycle: 'yearly',
        currentPeriodEnd: yearlyPeriodEnd,
        now: new Date('2027-06-21T00:00:00Z'), // 11 months + 20 days elapsed — < 1 month left
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });

  it('charges immediately for a combined yearly upgrade + cycle change inside the final month', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'growth',
        targetPlanKey: 'enterprise',
        currentCycle: 'yearly',
        targetCycle: 'monthly',
        currentPeriodEnd: yearlyPeriodEnd,
        now: new Date('2027-06-21T00:00:00Z'),
      }),
    );
    expect(result).toEqual({
      classification: 'immediate_prorate',
      tierDirection: 'upgrade',
      cycleChanged: true,
    });
  });
});

// ── time-independence of the upgrade branch ─────────────────────────────────

describe('classifyPlanChange — upgrades are time-independent', () => {
  it('classifies an upgrade the same with `now` omitted as with `now` pinned', () => {
    // `now` is no longer consulted for any branch. Omitting it (the shape both
    // billing routes use) must therefore give the identical verdict, and must
    // not fall back to a real-clock comparison against `currentPeriodEnd`.
    const withoutNow = classifyPlanChange({
      currentPlanKey: 'starter',
      currentCycle: 'monthly',
      targetPlanKey: 'growth',
      targetCycle: 'monthly',
      // Deliberately already in the past: under the old policy this was the
      // strongest possible "schedule it" signal.
      currentPeriodEnd: new Date('2020-01-01T00:00:00Z'),
    });
    const withNow = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        currentCycle: 'monthly',
        targetPlanKey: 'growth',
        targetCycle: 'monthly',
        currentPeriodEnd: new Date('2020-01-01T00:00:00Z'),
        now: NOW,
      }),
    );
    expect(withoutNow.classification).toBe('immediate_prorate');
    expect(withoutNow).toEqual(withNow);
  });
});
