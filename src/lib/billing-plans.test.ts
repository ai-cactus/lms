/**
 * Unit tests for src/lib/billing-plans.ts — the single source of truth for the
 * 4-tier plan lineup (starter/growth/pro/enterprise) and the `canSelectPlan`
 * staff-band gate that the checkout route and the SubscriptionTab UI both
 * defer to. Boundary values (10/11, 50/51, 150/151) are the highest-value
 * cases here: an off-by-one either blocks a legitimate upgrade or lets an
 * org select a plan its staff count no longer fits.
 */
import { describe, it, expect } from 'vitest';
import { BILLING_PLANS, canSelectPlan, type PlanKey } from './billing-plans';

function planByKey(key: PlanKey) {
  const plan = BILLING_PLANS.find((p) => p.key === key);
  if (!plan) throw new Error(`Fixture bug: no plan with key ${key}`);
  return plan;
}

describe('BILLING_PLANS — staff bands', () => {
  it('defines exactly the 4 tiers in ascending order: starter, growth, pro, enterprise', () => {
    expect(BILLING_PLANS.map((p) => p.key)).toEqual(['starter', 'growth', 'pro', 'enterprise']);
  });

  it('starter spans 1–10 staff', () => {
    const starter = planByKey('starter');
    expect(starter.staffMin).toBe(1);
    expect(starter.staffMax).toBe(10);
  });

  it('growth spans 11–50 staff', () => {
    const growth = planByKey('growth');
    expect(growth.staffMin).toBe(11);
    expect(growth.staffMax).toBe(50);
  });

  it('pro spans 51–150 staff', () => {
    const pro = planByKey('pro');
    expect(pro.staffMin).toBe(51);
    expect(pro.staffMax).toBe(150);
  });

  it('enterprise starts at 151 staff with no upper bound', () => {
    const enterprise = planByKey('enterprise');
    expect(enterprise.staffMin).toBe(151);
    expect(enterprise.staffMax).toBeNull();
    expect(enterprise.isEnterprise).toBe(true);
  });

  it('bands are contiguous with no gap or overlap between adjacent tiers', () => {
    for (let i = 0; i < BILLING_PLANS.length - 1; i++) {
      const current = BILLING_PLANS[i];
      const next = BILLING_PLANS[i + 1];
      if (current.staffMax === null) continue; // enterprise has no successor
      expect(next.staffMin).toBe(current.staffMax + 1);
    }
  });

  it('marks growth (and only growth) as popular', () => {
    const popularKeys = BILLING_PLANS.filter((p) => p.popular).map((p) => p.key);
    expect(popularKeys).toEqual(['growth']);
  });
});

describe('canSelectPlan — starter (staffMax 10)', () => {
  it('is selectable at exactly the 10-staff ceiling', () => {
    expect(canSelectPlan(planByKey('starter'), 10)).toBe(true);
  });

  it('is not selectable at 11 staff — one over the ceiling', () => {
    expect(canSelectPlan(planByKey('starter'), 11)).toBe(false);
  });
});

describe('canSelectPlan — growth (staffMin 11, staffMax 50)', () => {
  it('is selectable at 11 staff (an org small enough to fit, upgrading in)', () => {
    expect(canSelectPlan(planByKey('growth'), 11)).toBe(true);
  });

  it('is selectable at exactly the 50-staff ceiling', () => {
    expect(canSelectPlan(planByKey('growth'), 50)).toBe(true);
  });

  it('is not selectable at 51 staff — one over the ceiling', () => {
    expect(canSelectPlan(planByKey('growth'), 51)).toBe(false);
  });
});

describe('canSelectPlan — pro (staffMin 51, staffMax 150)', () => {
  it('is selectable at 51 staff (an org small enough to fit, upgrading in)', () => {
    expect(canSelectPlan(planByKey('pro'), 51)).toBe(true);
  });

  it('is selectable at exactly the 150-staff ceiling', () => {
    expect(canSelectPlan(planByKey('pro'), 150)).toBe(true);
  });

  it('is not selectable at 151 staff — one over the ceiling', () => {
    expect(canSelectPlan(planByKey('pro'), 151)).toBe(false);
  });
});

describe('canSelectPlan — enterprise is always selectable (contact-only, no ceiling)', () => {
  it.each([0, 1, 10, 51, 150, 151, 10_000])('is selectable at %i staff', (staffCount) => {
    expect(canSelectPlan(planByKey('enterprise'), staffCount)).toBe(true);
  });
});

describe('canSelectPlan — a plan is always selectable for an org already within its band (upgrade path)', () => {
  it('allows selecting a higher tier than currently needed (upgrade is never blocked)', () => {
    // A 5-staff org (fits starter) can still select growth/pro — only a
    // downgrade below the current staff count is blocked.
    expect(canSelectPlan(planByKey('growth'), 5)).toBe(true);
    expect(canSelectPlan(planByKey('pro'), 5)).toBe(true);
  });
});
