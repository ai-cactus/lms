/**
 * Unit tests for the pure, client-safe formatters in
 * src/lib/billing-price-format.ts. No mocking needed — `StripePriceInfo` is
 * imported as a type only, so this file never pulls in the `server-only`
 * `billing-prices.ts` module at runtime.
 */
import { describe, it, expect } from 'vitest';
import {
  getPlanCardPrice,
  getDiscountPercent,
  formatCycleTotal,
  formatCents,
} from './billing-price-format';
import type { StripePriceInfo } from './billing-prices';

function priceInfo(overrides: Partial<StripePriceInfo> = {}): StripePriceInfo {
  return {
    unitAmountCents: 9900,
    currency: 'usd',
    interval: 'month',
    intervalCount: 1,
    effectiveMonthlyCents: 9900,
    ...overrides,
  };
}

describe('getPlanCardPrice', () => {
  it('rounds a quarterly effective-monthly figure to whole dollars (defect repro: $41, not $99)', () => {
    const info = priceInfo({
      unitAmountCents: 12400,
      interval: 'month',
      intervalCount: 3,
      effectiveMonthlyCents: 4133,
    });
    expect(getPlanCardPrice(info)).toBe(41);
  });

  it('returns the exact monthly dollar amount for a plain monthly price (defect repro: $99)', () => {
    const info = priceInfo({
      unitAmountCents: 9900,
      interval: 'month',
      intervalCount: 1,
      effectiveMonthlyCents: 9900,
    });
    expect(getPlanCardPrice(info)).toBe(99);
  });

  it('returns null when the price info is undefined', () => {
    expect(getPlanCardPrice(undefined)).toBeNull();
  });
});

describe('getDiscountPercent', () => {
  it('computes the correct discount percent for a cheaper cycle vs. the monthly baseline', () => {
    const monthly = priceInfo({ effectiveMonthlyCents: 9900 });
    const yearly = priceInfo({ effectiveMonthlyCents: 7425 }); // 25% cheaper per month
    expect(getDiscountPercent(monthly, yearly)).toBe(25);
  });

  it('returns null when the monthly baseline price is missing', () => {
    expect(getDiscountPercent(undefined, priceInfo())).toBeNull();
  });

  it('returns null when the cycle price is missing', () => {
    expect(getDiscountPercent(priceInfo(), undefined)).toBeNull();
  });

  it('returns null (never negative) when the cycle is actually more expensive per month', () => {
    const monthly = priceInfo({ effectiveMonthlyCents: 9900 });
    const pricier = priceInfo({ effectiveMonthlyCents: 10900 });
    expect(getDiscountPercent(monthly, pricier)).toBeNull();
  });

  it('returns null when comparing a price to itself (zero discount)', () => {
    const info = priceInfo({ effectiveMonthlyCents: 9900 });
    expect(getDiscountPercent(info, info)).toBeNull();
  });
});

describe('formatCycleTotal', () => {
  it('formats a USD unit amount as a currency string', () => {
    expect(formatCycleTotal(priceInfo({ unitAmountCents: 12400, currency: 'usd' }))).toBe(
      '$124.00',
    );
  });

  it('formats a non-USD currency correctly', () => {
    expect(formatCycleTotal(priceInfo({ unitAmountCents: 5000, currency: 'eur' }))).toBe('€50.00');
  });

  it('returns null when the price info is undefined', () => {
    expect(formatCycleTotal(undefined)).toBeNull();
  });
});

describe('formatCents', () => {
  it('formats a USD amount, uppercasing a lowercase currency code', () => {
    expect(formatCents(4200, 'usd')).toBe('$42.00');
  });

  it('formats a USD amount when the currency code is already uppercase', () => {
    expect(formatCents(4200, 'USD')).toBe('$42.00');
  });

  it('formats a non-USD currency correctly', () => {
    expect(formatCents(5000, 'eur')).toBe('€50.00');
  });

  it('formats zero cents as $0.00', () => {
    expect(formatCents(0, 'usd')).toBe('$0.00');
  });

  it('rounds sub-cent Stripe proration figures to the nearest cent when formatting', () => {
    // Stripe's `amount_due` on a proration preview is always an integer number
    // of minor units, but the formatter itself should still round defensively
    // rather than truncate if ever handed a fractional value.
    expect(formatCents(1050.6, 'usd')).toBe('$10.51');
  });

  it('formats a large amount with thousands separators', () => {
    expect(formatCents(123456789, 'usd')).toBe('$1,234,567.89');
  });

  it('formats a negative amount (e.g. a proration credit) with a minus sign', () => {
    expect(formatCents(-500, 'usd')).toBe('-$5.00');
  });
});
