import { BILLING_PLANS } from '@/lib/billing-plans';
import type { HelpPlanPricing } from '@/lib/help/pricing';

/**
 * The plan lineup shown inside the "How does pricing work?" answer. Tiers and
 * headcount bands come from the billing registry so the answer can never drift
 * from what checkout actually offers; the price labels are supplied by the
 * hosting server component and are simply omitted when unavailable.
 */
export function HelpPricingTable({ pricing }: { pricing?: HelpPlanPricing[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {BILLING_PLANS.map((plan) => {
        const planPricing = pricing?.find((entry) => entry.key === plan.key);

        return (
          <li
            key={plan.key}
            className="rounded-lg border border-border bg-background-secondary p-3 sm:p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-sm font-semibold text-foreground">{plan.name}</span>
              {planPricing?.monthlyLabel && (
                <span className="text-sm font-semibold text-foreground">
                  {planPricing.monthlyLabel}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-text-secondary">{plan.description}</p>
            {planPricing?.annualLabel && (
              <p className="mt-1 text-xs text-text-secondary">{planPricing.annualLabel}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
