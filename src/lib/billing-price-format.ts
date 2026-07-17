import type { StripePriceInfo } from '@/lib/billing-prices';

/**
 * Pure, client-safe formatters for Stripe-derived plan prices. Kept separate
 * from `billing-prices.ts` (which is `server-only`) so client components can
 * import these value functions while importing the price types as `import type`
 * only.
 */

/** Whole-dollar effective monthly price for a plan card, or null when unknown. */
export function getPlanCardPrice(info: StripePriceInfo | undefined): number | null {
  return info ? Math.round(info.effectiveMonthlyCents / 100) : null;
}

/**
 * Stripe-derived discount percent of a cycle vs. the monthly baseline. Returns
 * null when either price is missing or the computed discount is not positive.
 */
export function getDiscountPercent(
  monthlyInfo: StripePriceInfo | undefined,
  cycleInfo: StripePriceInfo | undefined,
): number | null {
  if (!monthlyInfo || !cycleInfo) return null;
  const discount = Math.round(
    (1 - cycleInfo.effectiveMonthlyCents / monthlyInfo.effectiveMonthlyCents) * 100,
  );
  return discount > 0 ? discount : null;
}

/**
 * The real per-cycle total charged by Stripe, formatted as a currency string
 * (e.g. "$124.00"). Null when the price is unknown. This is the concrete
 * commitment figure shown at confirmation.
 */
export function formatCycleTotal(info: StripePriceInfo | undefined): string | null {
  if (!info) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: info.currency.toUpperCase(),
  }).format(info.unitAmountCents / 100);
}

/**
 * Formats a raw minor-unit amount (cents) plus an ISO currency code as a
 * currency string (e.g. `4200`, `"usd"` → "$42.00"). Used for the Stripe
 * proration-preview figure shown in the plan-change confirmation dialog.
 */
export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
