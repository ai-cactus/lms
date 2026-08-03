import 'server-only';

import { BILLING_PLANS, type PlanKey } from '@/lib/billing-plans';
import { getPlanPrices } from '@/lib/billing-prices';
import { getPlanCardPrice } from '@/lib/billing-price-format';

/**
 * A plan row for the Help Center pricing answer. Price labels are null when
 * Stripe could not supply a price, so the answer degrades to the tier lineup
 * without inventing figures.
 */
export interface HelpPlanPricing {
  key: PlanKey;
  monthlyLabel: string | null;
  annualLabel: string | null;
}

const CUSTOM_PRICE_LABEL = 'Custom';

export async function getHelpPlanPricing(): Promise<HelpPlanPricing[]> {
  const prices = await getPlanPrices();

  return BILLING_PLANS.map((plan) => {
    if (plan.isEnterprise) {
      return { key: plan.key, monthlyLabel: CUSTOM_PRICE_LABEL, annualLabel: null };
    }

    const monthly = getPlanCardPrice(prices[plan.key]?.monthly);
    const yearly = getPlanCardPrice(prices[plan.key]?.yearly);

    return {
      key: plan.key,
      monthlyLabel: monthly === null ? null : `$${monthly} / mo`,
      annualLabel: yearly === null ? null : `$${yearly} / mo billed annually`,
    };
  });
}
