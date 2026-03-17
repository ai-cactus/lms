// Single source of truth for billing plans — used by both UI and API
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';
export type PlanKey = 'starter' | 'professional' | 'enterprise';

export interface BillingPlan {
  key: PlanKey;
  name: string;
  staffMin: number;
  staffMax: number | null; // null = unlimited
  monthlyPrice: number; // base monthly price in USD
  description: string;
  features: string[];
  featuresLabel: string;
  priceId: Record<BillingCycle, string | null>; // null for enterprise (custom)
  isEnterprise: boolean;
}

const STARTER_MONTHLY_PRICE_ID = process.env.STRIPE_STARTER_PRICE_ID ?? '';
const PROFESSIONAL_MONTHLY_PRICE_ID = process.env.STRIPE_PROFESSIONAL_PRICE_ID ?? '';
const STARTER_QUARTERLY_PRICE_ID = process.env.STRIPE_STARTER_QUARTERLY_PRICE_ID ?? '';
const PROFESSIONAL_QUARTERLY_PRICE_ID = process.env.STRIPE_PROFESSIONAL_QUARTERLY_PRICE_ID ?? '';
const STARTER_YEARLY_PRICE_ID = process.env.STRIPE_STARTER_YEARLY_PRICE_ID ?? '';
const PROFESSIONAL_YEARLY_PRICE_ID = process.env.STRIPE_PROFESSIONAL_YEARLY_PRICE_ID ?? '';

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: 'starter',
    name: 'Starter',
    staffMin: 1,
    staffMax: 10,
    monthlyPrice: 99,
    description: '1-10 staff',
    featuresLabel: 'INCLUDES',
    features: ['Staff training records', 'Policy-linked training', 'Auditor pack export'],
    priceId: {
      monthly: STARTER_MONTHLY_PRICE_ID,
      quarterly: STARTER_QUARTERLY_PRICE_ID,
      yearly: STARTER_YEARLY_PRICE_ID,
    },
    isEnterprise: false,
  },
  {
    key: 'professional',
    name: 'Professional',
    staffMin: 11,
    staffMax: 50,
    monthlyPrice: 149,
    description: '11-50 staff',
    featuresLabel: 'EVERYTHING IN STARTER PLUS',
    features: ['Advanced analytics', 'Priority processing'],
    priceId: {
      monthly: PROFESSIONAL_MONTHLY_PRICE_ID,
      quarterly: PROFESSIONAL_QUARTERLY_PRICE_ID,
      yearly: PROFESSIONAL_YEARLY_PRICE_ID,
    },
    isEnterprise: false,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    staffMin: 100,
    staffMax: null,
    monthlyPrice: 0,
    description: '100+ staff',
    featuresLabel: 'INCLUDES',
    features: [
      'Multi-location organizations',
      'Enterprise onboarding',
      'Priority support',
      'Contract pricing',
    ],
    priceId: {
      monthly: null,
      quarterly: null,
      yearly: null,
    },
    isEnterprise: true,
  },
];

// Discounts per billing cycle
export const CYCLE_DISCOUNTS: Record<BillingCycle, number> = {
  monthly: 0,
  quarterly: 0.1, // -10%
  yearly: 0.25, // -25%
};

// Calculate the effective monthly price for a given plan and cycle
export function getEffectiveMonthlyPrice(plan: BillingPlan, cycle: BillingCycle): number {
  const discount = CYCLE_DISCOUNTS[cycle];
  return Math.round(plan.monthlyPrice * (1 - discount));
}

/**
 * Returns whether an organization with the given staff count
 * is ALLOWED to select a given plan.
 * Rule: a plan can only be selected if staffCount <= plan.staffMax (allow upgrade, restrict downgrade).
 * Enterprise is always available as a contact option.
 */
export function canSelectPlan(plan: BillingPlan, orgStaffCount: number): boolean {
  if (plan.isEnterprise) return true; // Enterprise is contact-only, always shown
  if (plan.staffMax === null) return true;
  // Allow plan if org staff fits within or BELOW the plan's max ceiling
  // (upgrades allowed, downgrades blocked)
  return orgStaffCount <= plan.staffMax;
}
