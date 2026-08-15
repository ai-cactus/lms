// Single source of truth for billing plans — used by both UI and API
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';
export type PlanKey = 'starter' | 'growth' | 'pro' | 'enterprise';

export interface BillingPlan {
  key: PlanKey;
  name: string;
  staffMin: number;
  staffMax: number | null; // null = unlimited
  description: string;
  features: string[];
  featuresLabel: string;
  priceId: Record<BillingCycle, string | null>; // null for enterprise (custom)
  isEnterprise: boolean;
  popular?: boolean;
}

const STARTER_MONTHLY_PRICE_ID = process.env.STRIPE_STARTER_PRICE_ID ?? '';
const STARTER_QUARTERLY_PRICE_ID = process.env.STRIPE_STARTER_QUARTERLY_PRICE_ID ?? '';
const STARTER_YEARLY_PRICE_ID = process.env.STRIPE_STARTER_YEARLY_PRICE_ID ?? '';
const GROWTH_MONTHLY_PRICE_ID = process.env.STRIPE_GROWTH_PRICE_ID ?? '';
const GROWTH_QUARTERLY_PRICE_ID = process.env.STRIPE_GROWTH_QUARTERLY_PRICE_ID ?? '';
const GROWTH_YEARLY_PRICE_ID = process.env.STRIPE_GROWTH_YEARLY_PRICE_ID ?? '';
const PRO_MONTHLY_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? '';
const PRO_QUARTERLY_PRICE_ID = process.env.STRIPE_PRO_QUARTERLY_PRICE_ID ?? '';
const PRO_YEARLY_PRICE_ID = process.env.STRIPE_PRO_YEARLY_PRICE_ID ?? '';

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: 'starter',
    name: 'Starter',
    staffMin: 1,
    staffMax: 10,
    description: 'Up to 10 staff — solo practices & small local clinics',
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
    key: 'growth',
    name: 'Growth',
    staffMin: 11,
    staffMax: 50,
    description: '11–50 staff — single-location facilities',
    featuresLabel: 'EVERYTHING IN STARTER PLUS',
    features: ['Advanced analytics', 'Priority processing'],
    priceId: {
      monthly: GROWTH_MONTHLY_PRICE_ID,
      quarterly: GROWTH_QUARTERLY_PRICE_ID,
      yearly: GROWTH_YEARLY_PRICE_ID,
    },
    isEnterprise: false,
    popular: true,
  },
  {
    key: 'pro',
    name: 'Pro',
    staffMin: 51,
    staffMax: 150,
    description: '51–150 staff — multi-location facilities & regional agencies',
    featuresLabel: 'EVERYTHING IN GROWTH PLUS',
    features: ['Multi-location organizations', 'Priority support'],
    priceId: {
      monthly: PRO_MONTHLY_PRICE_ID,
      quarterly: PRO_QUARTERLY_PRICE_ID,
      yearly: PRO_YEARLY_PRICE_ID,
    },
    isEnterprise: false,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    staffMin: 151,
    staffMax: null,
    description: '151+ staff — hospitals & large healthcare networks',
    featuresLabel: 'EVERYTHING IN PRO PLUS',
    features: ['Enterprise onboarding', 'Contract pricing'],
    priceId: {
      monthly: null,
      quarterly: null,
      yearly: null,
    },
    isEnterprise: true,
  },
];

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
