'use client';

import React, { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import type { PlanPriceMap } from '@/lib/billing-prices';

type Tab = 'overview' | 'billing-history' | 'subscription' | 'payment-method';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'billing-history', label: 'Billing History' },
  { key: 'subscription', label: 'Subscription' },
  { key: 'payment-method', label: 'Payment Method' },
];

const MANAGE_SUBTITLE =
  'Manage your subscription plans, update payment methods, and download your previous invoices.';

const TAB_HEADINGS: Record<Tab, { title: string; subtitle: string }> = {
  overview: { title: 'Billing', subtitle: 'Manage your billing and payment details' },
  'billing-history': { title: 'Billing History', subtitle: MANAGE_SUBTITLE },
  subscription: { title: 'Subscription', subtitle: MANAGE_SUBTITLE },
  // The Payment Method tab renders its own header so the "Add Payment Method"
  // action can sit inline with the title, as in the design.
  'payment-method': { title: 'Payment Method', subtitle: MANAGE_SUBTITLE },
};

import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
// SubscriptionTab is imported statically (not via next/dynamic) so its content —
// including the paused-state "Continue Plan" action — is present in the same
// render commit as the `?tab=subscription` switch. A lazy ssr:false chunk paints
// a beat late, during which the only visible "Continue Plan" is the site-wide
// BillingPausedBanner, whose resume handler refreshes in place without leaving
// the tab; a fast click landed there instead of the subscription action.
import SubscriptionTab from './SubscriptionTab';
import BillingPageHeader from './BillingPageHeader';

const OverviewTab = dynamic(() => import('./OverviewTab'), { ssr: false });
const BillingHistoryTab = dynamic(() => import('./BillingHistoryTab'), { ssr: false });
const PaymentMethodTab = dynamic(() => import('./PaymentMethodTab'), { ssr: false });

interface BillingPageProps {
  /** Org-wide billable headcount (active non-owner members). */
  orgStaffCount: number;
  currentPlan: string | null;
  /** Live Stripe-derived plan prices, keyed by plan and cycle. */
  planPrices: PlanPriceMap;
  /** Whether a plan change would swap the live Stripe subscription in place. */
  hasLiveSubscription?: boolean;
  /** ISO timestamp a REQUESTED pause takes effect, or null. Full access until then. */
  pauseStartsAt?: string | null;
  /** ISO timestamp when billing was paused, or null when not paused. */
  pausedAt?: string | null;
  /** ISO timestamp when the pause window ends, or null. */
  pauseEndsAt?: string | null;
  /** Whether the subscription is scheduled to cancel at period end. */
  cancelAtPeriodEnd?: boolean;
  /** The subscription's billing cycle (e.g. 'monthly'), or null. */
  billingCycle?: string | null;
  /** ISO timestamp when the current billing period ends, or null. */
  currentPeriodEnd?: string | null;
  /** Display name of the plan a pending scheduled change moves to, or null. */
  scheduledPlanName?: string | null;
  /** ISO timestamp when a pending scheduled change takes effect, or null. */
  scheduledEffectiveAt?: string | null;
  initialTab?: Tab;
}

export default function BillingPage({
  orgStaffCount,
  currentPlan,
  planPrices,
  hasLiveSubscription = false,
  pauseStartsAt = null,
  pausedAt = null,
  pauseEndsAt = null,
  cancelAtPeriodEnd = false,
  billingCycle = null,
  currentPeriodEnd = null,
  scheduledPlanName = null,
  scheduledEffectiveAt = null,
  initialTab = 'overview',
}: BillingPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab') as Tab | null;

  // Bumped whenever the SubscriptionTab performs a mutation (resume, reactivate,
  // in-place plan swap) so the OverviewTab refetches its data on next mount.
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const bumpOverviewRefresh = useCallback(() => setOverviewRefreshKey((k) => k + 1), []);

  // Derive activeTab directly from URL — URL is the single source of truth
  const activeTab = tabParam && TABS.some((t) => t.key === tabParam) ? tabParam : initialTab;

  const handleTabChange = (tab: Tab) => {
    router.replace(`?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <div className="mb-8 flex gap-0 overflow-x-auto border-b border-[#e2e8f0]" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-5 pb-3 text-[15px] leading-[22px] font-medium whitespace-nowrap transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-[#667085] hover:text-primary',
            )}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab !== 'payment-method' && (
        <div className="mb-10">
          <BillingPageHeader
            title={TAB_HEADINGS[activeTab].title}
            subtitle={TAB_HEADINGS[activeTab].subtitle}
          />
        </div>
      )}

      {activeTab === 'overview' && (
        <OverviewTab onChangeTab={handleTabChange} refreshKey={overviewRefreshKey} />
      )}
      {activeTab === 'billing-history' && <BillingHistoryTab />}
      {activeTab === 'subscription' && (
        <SubscriptionTab
          orgStaffCount={orgStaffCount}
          currentPlan={currentPlan}
          planPrices={planPrices}
          hasLiveSubscription={hasLiveSubscription}
          pauseStartsAt={pauseStartsAt}
          pausedAt={pausedAt}
          pauseEndsAt={pauseEndsAt}
          cancelAtPeriodEnd={cancelAtPeriodEnd}
          billingCycle={billingCycle}
          currentPeriodEnd={currentPeriodEnd}
          scheduledPlanName={scheduledPlanName}
          scheduledEffectiveAt={scheduledEffectiveAt}
          onChangeTab={handleTabChange}
          onMutated={bumpOverviewRefresh}
        />
      )}
      {activeTab === 'payment-method' && <PaymentMethodTab />}
    </div>
  );
}
