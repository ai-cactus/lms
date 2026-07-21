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
 * CYCLE-CONSISTENCY INVARIANT (product decision, 2026-07-17): a live QA run
 * found that the previous version of this file asserted `immediate_prorate`
 * for upgrade scenarios using a `currentPeriodEnd` picked out of thin air
 * (e.g. "2 months out") while `currentCycle: 'monthly'` — a combination that
 * can never occur for a real subscription, since a monthly subscription's
 * `currentPeriodEnd` is ALWAYS exactly one calendar month after its period
 * start. Those tests passed while hiding a real bug: for a monthly
 * subscription, `isLessThanOneMonthRemaining(currentPeriodEnd, now)` is true
 * for every instant strictly after the period start, so a monthly tier
 * upgrade can NEVER classify as `immediate_prorate` — it always resolves to
 * `scheduled`. That is intentional and confirmed by the product owner: a
 * monthly upgrade runs to the end of the month and is charged at renewal,
 * never prorated mid-month. `immediate_prorate` is reachable only for
 * quarterly/yearly cycles, whose periods exceed one month.
 *
 * All `classifyPlanChange` upgrade tests below therefore derive
 * `currentPeriodEnd` from a realistic subscription start via `periodEndFor`,
 * so the period end is never divorced from the cycle attached to it. The
 * `isLessThanOneMonthRemaining` describe block below is the one exception —
 * it tests a pure, cycle-agnostic function by design, so arbitrary dates
 * remain valid there.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyPlanChange,
  isLessThanOneMonthRemaining,
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
 * the product code (see `isLessThanOneMonthRemaining` / `pauseEndDate()` in
 * billing.ts). This keeps every upgrade test's `now`/`currentPeriodEnd` pair
 * tied to a cycle that could actually occur, instead of a hand-picked date.
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
  it('ranks starter < professional < enterprise', () => {
    expect(PLAN_TIER_ORDER.starter).toBe(1);
    expect(PLAN_TIER_ORDER.professional).toBe(2);
    expect(PLAN_TIER_ORDER.enterprise).toBe(3);
    expect(PLAN_TIER_ORDER.starter).toBeLessThan(PLAN_TIER_ORDER.professional);
    expect(PLAN_TIER_ORDER.professional).toBeLessThan(PLAN_TIER_ORDER.enterprise);
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

// ── isLessThanOneMonthRemaining — boundary math (pure, cycle-agnostic) ──────

describe('isLessThanOneMonthRemaining', () => {
  it('returns false (not less than) when exactly one calendar month remains', () => {
    // now = 2026-07-17, periodEnd = 2026-08-17 — the task's own worked example.
    expect(isLessThanOneMonthRemaining(new Date('2026-08-17T12:00:00Z'), NOW)).toBe(false);
  });

  it('returns true (less than) when the period ends only ~3 weeks out', () => {
    // now = 2026-07-17, periodEnd = 2026-08-10 — the task's own worked example.
    expect(isLessThanOneMonthRemaining(new Date('2026-08-10T12:00:00Z'), NOW)).toBe(true);
  });

  it('flips to true one millisecond after the exact one-month boundary', () => {
    const periodEnd = new Date('2026-08-17T12:00:00Z');
    const justAfterBoundary = new Date(NOW.getTime() + 1);
    expect(isLessThanOneMonthRemaining(periodEnd, justAfterBoundary)).toBe(true);
  });

  it('stays false one millisecond before the exact one-month boundary', () => {
    const periodEnd = new Date('2026-08-17T12:00:00Z');
    const justBeforeBoundary = new Date(NOW.getTime() - 1);
    expect(isLessThanOneMonthRemaining(periodEnd, justBeforeBoundary)).toBe(false);
  });

  it('returns false when now is well before the period end (many months remaining)', () => {
    expect(isLessThanOneMonthRemaining(new Date('2027-07-17T12:00:00Z'), NOW)).toBe(false);
  });

  it('returns true when now is exactly at (or past) the period end itself', () => {
    expect(isLessThanOneMonthRemaining(NOW, NOW)).toBe(true); // period already over — 0 months remain
    expect(isLessThanOneMonthRemaining(new Date(NOW.getTime() - 1), NOW)).toBe(true); // period already past
  });

  it('documents the setMonth month-length overflow: Mar 31 minus 1 calendar month rolls to Mar 3, not Feb 28', () => {
    // 2026 is not a leap year, so February has 28 days. `new Date(2026-03-31)
    // .setMonth(1)` (February) overflows the nonexistent Feb 31 forward into
    // March, landing on Mar 3 — consistent with pauseEndDate()'s calendar-month
    // arithmetic elsewhere in this codebase (see billing.ts). This pins that
    // documented behavior rather than the naive "Feb 28" expectation.
    const periodEnd = new Date('2026-03-31T12:00:00Z');
    const dayBeforeOverflowBoundary = new Date('2026-03-02T12:00:00Z');
    const dayAfterOverflowBoundary = new Date('2026-03-04T12:00:00Z');
    expect(isLessThanOneMonthRemaining(periodEnd, dayBeforeOverflowBoundary)).toBe(false);
    expect(isLessThanOneMonthRemaining(periodEnd, dayAfterOverflowBoundary)).toBe(true);
  });
});

// ── classifyPlanChange — same tier ──────────────────────────────────────────

describe('classifyPlanChange — same tier, same cycle (no_op)', () => {
  it.each<PlanKey>(['starter', 'professional', 'enterprise'])(
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
        currentPlanKey: 'professional',
        targetPlanKey: 'professional',
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
        currentPlanKey: 'professional',
        targetPlanKey: 'professional',
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
  it('schedules professional -> starter with the same cycle', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'professional',
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

  it('schedules professional -> starter with LOTS of time remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'professional',
        targetPlanKey: 'starter',
        currentPeriodEnd: new Date('2027-07-17T12:00:00Z'),
      }),
    );
    expect(result.classification).toBe('scheduled');
  });

  it('schedules professional -> starter with almost no time remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'professional',
        targetPlanKey: 'starter',
        currentPeriodEnd: new Date('2026-07-18T12:00:00Z'), // 1 day left
      }),
    );
    expect(result.classification).toBe('scheduled');
  });

  it('schedules enterprise -> professional (downgrade from the top tier)', () => {
    const result = classifyPlanChange(
      input({ currentPlanKey: 'enterprise', targetPlanKey: 'professional' }),
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
        currentPlanKey: 'professional',
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

// ── classifyPlanChange — MONTHLY tier upgrades (anti-regression guard) ─────
//
// The classification for an upgrade depends only on `currentCycle` (via
// `currentPeriodEnd`), never on `targetCycle` — so ANY upgrade whose CURRENT
// subscription is monthly always schedules, regardless of what cycle it's
// upgrading to.

describe('classifyPlanChange — monthly tier upgrade always schedules to period end — charged at renewal, never mid-month proration (product decision 2026-07-17)', () => {
  const monthlyPeriodEnd = periodEndFor(SUBSCRIPTION_START, 'monthly'); // 2026-08-01T00:00:00Z

  // `now` values strictly after the period start. The literal period-start
  // instant itself (0 elapsed time, exactly 1 month remaining) is the sole
  // exception carved out by `isLessThanOneMonthRemaining`'s own boundary
  // rule (see the boundary describe block above) and is not exercised here.
  it.each<[string, Date]>([
    ['1ms after period start', new Date(SUBSCRIPTION_START.getTime() + 1)],
    ['1 second after period start', new Date(SUBSCRIPTION_START.getTime() + 1000)],
    ['3 days into the period', addDays(SUBSCRIPTION_START, 3)],
    ['20 days into the period (past the midpoint)', addDays(SUBSCRIPTION_START, 20)],
  ])(
    'schedules starter -> professional (monthly) at %s — never immediate_prorate',
    (_label, now) => {
      const result = classifyPlanChange(
        input({
          currentPlanKey: 'starter',
          targetPlanKey: 'professional',
          currentCycle: 'monthly',
          targetCycle: 'monthly',
          currentPeriodEnd: monthlyPeriodEnd,
          now,
        }),
      );
      expect(result).toEqual({
        classification: 'scheduled',
        tierDirection: 'upgrade',
        cycleChanged: false,
      });
    },
  );

  it('schedules a monthly upgrade even when it is ALSO a cycle change to yearly (target cycle never grants immediate_prorate)', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'professional',
        currentCycle: 'monthly',
        targetCycle: 'yearly',
        currentPeriodEnd: monthlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 3),
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'upgrade',
      cycleChanged: true,
    });
  });

  it('schedules enterprise-bound monthly upgrades too (professional -> enterprise, monthly)', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'professional',
        targetPlanKey: 'enterprise',
        currentCycle: 'monthly',
        targetCycle: 'monthly',
        currentPeriodEnd: monthlyPeriodEnd,
        now: addDays(SUBSCRIPTION_START, 10),
      }),
    );
    expect(result.classification).toBe('scheduled');
  });
});

// ── classifyPlanChange — QUARTERLY tier upgrades ────────────────────────────

describe('classifyPlanChange — quarterly tier upgrade (immediate_prorate early, scheduled once inside the final month)', () => {
  const quarterlyPeriodEnd = periodEndFor(SUBSCRIPTION_START, 'quarterly'); // 2026-10-01T00:00:00Z

  it('charges immediately for starter -> professional (quarterly) early in the period, ~3 months remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'professional',
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

  it('charges immediately for a combined quarterly upgrade + cycle change (starter/quarterly -> professional/monthly), ~3 months remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'professional',
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

  it('charges immediately at exactly the 1-month boundary (2 months elapsed of the 3-month period)', () => {
    // oneMonthBeforeEnd for this period is 2026-09-01T00:00:00Z exactly.
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'professional',
        currentCycle: 'quarterly',
        targetCycle: 'quarterly',
        currentPeriodEnd: quarterlyPeriodEnd,
        now: new Date('2026-09-01T00:00:00Z'),
      }),
    );
    expect(result.classification).toBe('immediate_prorate');
  });

  it('schedules starter -> professional (quarterly) once inside the final month, < 1 month remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'starter',
        targetPlanKey: 'professional',
        currentCycle: 'quarterly',
        targetCycle: 'quarterly',
        currentPeriodEnd: quarterlyPeriodEnd,
        now: new Date('2026-09-05T00:00:00Z'), // 2 months + 4 days elapsed — < 1 month left
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });
});

// ── classifyPlanChange — YEARLY tier upgrades ───────────────────────────────

describe('classifyPlanChange — yearly tier upgrade (immediate_prorate early, scheduled once inside the final month)', () => {
  const yearlyPeriodEnd = periodEndFor(SUBSCRIPTION_START, 'yearly'); // 2027-07-01T00:00:00Z

  it('charges immediately for professional -> enterprise (yearly) early in the period, ~12 months remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'professional',
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

  it('schedules professional -> enterprise (yearly) once inside the final month, < 1 month remaining', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'professional',
        targetPlanKey: 'enterprise',
        currentCycle: 'yearly',
        targetCycle: 'yearly',
        currentPeriodEnd: yearlyPeriodEnd,
        now: new Date('2027-06-21T00:00:00Z'), // 11 months + 20 days elapsed — < 1 month left
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'upgrade',
      cycleChanged: false,
    });
  });

  it('schedules a combined yearly upgrade + cycle change once inside the final month (tier upgrade is real but time-limited, cycle change is incidental)', () => {
    const result = classifyPlanChange(
      input({
        currentPlanKey: 'professional',
        targetPlanKey: 'enterprise',
        currentCycle: 'yearly',
        targetCycle: 'monthly',
        currentPeriodEnd: yearlyPeriodEnd,
        now: new Date('2027-06-21T00:00:00Z'),
      }),
    );
    expect(result).toEqual({
      classification: 'scheduled',
      tierDirection: 'upgrade',
      cycleChanged: true,
    });
  });
});

// ── now defaulting ───────────────────────────────────────────────────────────

describe('classifyPlanChange — now defaulting', () => {
  it('defaults `now` to the real current time when omitted', () => {
    // A yearly period end far in the future relative to the real clock must
    // always classify as immediate_prorate for an upgrade — this exercises
    // the `now ?? new Date()` fallback without asserting on a specific
    // instant. Cycle is yearly (not monthly) so this stays consistent with
    // the monthly-always-schedules invariant locked in above.
    const result = classifyPlanChange({
      currentPlanKey: 'starter',
      currentCycle: 'yearly',
      targetPlanKey: 'professional',
      targetCycle: 'yearly',
      currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 300), // ~300 days out
    });
    expect(result.classification).toBe('immediate_prorate');
  });
});
