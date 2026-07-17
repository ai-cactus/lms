/**
 * Unit tests for `fetchPlanPricesUncached` (src/lib/billing-prices.ts) — the
 * uncached Stripe-as-source-of-truth price fetcher. Tested directly (never
 * through the `unstable_cache`-wrapped `getPlanPrices`) so each case controls
 * its own Stripe responses deterministically.
 *
 * `server-only` is stubbed because the real package throws outside a React
 * Server Component module graph (Next's `react-server` resolve condition
 * isn't set under vitest/jsdom) — see the identical crash this caused in
 * `page.test.tsx` before it was fixed alongside this file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { mockRetrieve, loggerMock } = vi.hoisted(() => ({
  mockRetrieve: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/stripe', () => ({
  getStripeClient: () => ({ prices: { retrieve: mockRetrieve } }),
}));
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));

// Deterministic plan/price-id fixture, independent of real env vars — 2
// billable plans x 3 cycles (6 prices, matching the real Stripe object count)
// plus enterprise (no price ids — contact-only).
vi.mock('@/lib/billing-plans', () => ({
  BILLING_PLANS: [
    {
      key: 'starter',
      priceId: {
        monthly: 'price_starter_monthly',
        quarterly: 'price_starter_quarterly',
        yearly: 'price_starter_yearly',
      },
    },
    {
      key: 'professional',
      priceId: {
        monthly: 'price_pro_monthly',
        quarterly: 'price_pro_quarterly',
        yearly: 'price_pro_yearly',
      },
    },
    {
      key: 'enterprise',
      priceId: { monthly: null, quarterly: null, yearly: null },
    },
  ],
}));

import { fetchPlanPricesUncached } from './billing-prices';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function stripePrice(overrides: Record<string, unknown> = {}) {
  return {
    unit_amount: 9900,
    currency: 'usd',
    recurring: { interval: 'month', interval_count: 1 },
    ...overrides,
  };
}

const ALL_SIX_PRICES: Record<string, ReturnType<typeof stripePrice>> = {
  price_starter_monthly: stripePrice({ unit_amount: 9900 }),
  price_starter_quarterly: stripePrice({
    unit_amount: 27000,
    recurring: { interval: 'month', interval_count: 3 },
  }),
  price_starter_yearly: stripePrice({
    unit_amount: 89000,
    recurring: { interval: 'year', interval_count: 1 },
  }),
  price_pro_monthly: stripePrice({ unit_amount: 14900 }),
  price_pro_quarterly: stripePrice({
    unit_amount: 40000,
    recurring: { interval: 'month', interval_count: 3 },
  }),
  price_pro_yearly: stripePrice({
    unit_amount: 134000,
    recurring: { interval: 'year', interval_count: 1 },
  }),
};

function resolveKnownPrices(overrides: Record<string, unknown> = {}) {
  const table = { ...ALL_SIX_PRICES, ...overrides };
  mockRetrieve.mockImplementation((id: string) => {
    if (!(id in table)) return Promise.reject(new Error(`unexpected price id: ${id}`));
    return Promise.resolve(table[id]);
  });
}

const ORIGINAL_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_for_unit_tests';
});

afterEach(() => {
  // Never leak the test env var into other test files' STRIPE_SECRET_KEY checks.
  if (ORIGINAL_STRIPE_SECRET_KEY === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_SECRET_KEY;
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('fetchPlanPricesUncached — happy path', () => {
  it('builds a full price map with correct effectiveMonthlyCents for quarterly and yearly intervals', async () => {
    resolveKnownPrices();

    const result = await fetchPlanPricesUncached();

    expect(result.starter.monthly).toEqual({
      unitAmountCents: 9900,
      currency: 'usd',
      interval: 'month',
      intervalCount: 1,
      effectiveMonthlyCents: 9900,
    });
    // Quarterly (interval: 'month', interval_count: 3) — months = 3.
    expect(result.starter.quarterly).toEqual({
      unitAmountCents: 27000,
      currency: 'usd',
      interval: 'month',
      intervalCount: 3,
      effectiveMonthlyCents: 9000, // 27000 / 3
    });
    // Yearly (interval: 'year', interval_count: 1) — months = 12 * 1.
    expect(result.starter.yearly).toEqual({
      unitAmountCents: 89000,
      currency: 'usd',
      interval: 'year',
      intervalCount: 1,
      effectiveMonthlyCents: Math.round(89000 / 12), // 7417
    });
    expect(result.professional.monthly?.effectiveMonthlyCents).toBe(14900);
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('initializes the enterprise plan key to an empty object and never looks it up', async () => {
    resolveKnownPrices();

    const result = await fetchPlanPricesUncached();

    expect(result.enterprise).toEqual({});
    expect(mockRetrieve).toHaveBeenCalledTimes(6); // 2 billable plans x 3 cycles
    expect(mockRetrieve).not.toHaveBeenCalledWith(null);
    expect(mockRetrieve).not.toHaveBeenCalledWith(undefined);
  });
});

describe('fetchPlanPricesUncached — partial Stripe failures', () => {
  it('omits only the rejected entry, keeps the rest, logs an error, and never throws', async () => {
    resolveKnownPrices();
    mockRetrieve.mockImplementation((id: string) =>
      id === 'price_starter_monthly'
        ? Promise.reject(new Error('Stripe API unavailable'))
        : Promise.resolve(ALL_SIX_PRICES[id]),
    );

    const result = await fetchPlanPricesUncached();

    expect(result.starter.monthly).toBeUndefined();
    expect(result.starter.quarterly).toBeDefined();
    expect(result.starter.yearly).toBeDefined();
    expect(result.professional.monthly).toBeDefined();
    expect(loggerMock.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        msg: expect.stringContaining('Failed to retrieve Stripe price'),
        planKey: 'starter',
        cycle: 'monthly',
        priceId: 'price_starter_monthly',
      }),
    );
  });

  it('resolves the full map (no throw) even when every retrieve call rejects', async () => {
    mockRetrieve.mockRejectedValue(new Error('network down'));

    await expect(fetchPlanPricesUncached()).resolves.toEqual({
      starter: {},
      professional: {},
      enterprise: {},
    });
    expect(loggerMock.error).toHaveBeenCalledTimes(6);
  });
});

describe('fetchPlanPricesUncached — STRIPE_SECRET_KEY unset', () => {
  it('returns an empty map, never calls Stripe, and logs a warning', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    resolveKnownPrices();

    const result = await fetchPlanPricesUncached();

    expect(result).toEqual({ starter: {}, professional: {}, enterprise: {} });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ msg: expect.stringContaining('STRIPE_SECRET_KEY unset') }),
    );
  });
});

describe('fetchPlanPricesUncached — unexpected Stripe price shapes', () => {
  it('skips a price with a null unit_amount and logs a warning', async () => {
    resolveKnownPrices({ price_starter_monthly: stripePrice({ unit_amount: null }) });

    const result = await fetchPlanPricesUncached();

    expect(result.starter.monthly).toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        msg: expect.stringContaining('Unexpected Stripe price shape'),
        planKey: 'starter',
        cycle: 'monthly',
      }),
    );
  });

  it('skips a price with null recurring (a one-time price) and logs a warning', async () => {
    resolveKnownPrices({ price_starter_monthly: stripePrice({ recurring: null }) });

    const result = await fetchPlanPricesUncached();

    expect(result.starter.monthly).toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ msg: expect.stringContaining('Unexpected Stripe price shape') }),
    );
  });

  it('skips a price with an unsupported recurring interval (week) and logs a warning', async () => {
    resolveKnownPrices({
      price_starter_monthly: stripePrice({ recurring: { interval: 'week', interval_count: 1 } }),
    });

    const result = await fetchPlanPricesUncached();

    expect(result.starter.monthly).toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ msg: expect.stringContaining('Unexpected Stripe price shape') }),
    );
  });

  it('still returns every other valid price when one has an unsupported shape', async () => {
    resolveKnownPrices({
      price_starter_monthly: stripePrice({ recurring: { interval: 'week', interval_count: 1 } }),
    });

    const result = await fetchPlanPricesUncached();

    expect(result.starter.quarterly).toBeDefined();
    expect(result.professional.monthly).toBeDefined();
    expect(result.professional.yearly).toBeDefined();
  });
});
