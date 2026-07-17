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

import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
// SubscriptionTab is imported statically (not via next/dynamic) so its content —
// including the paused-state "Continue Plan" action — is present in the same
// render commit as the `?tab=subscription` switch. A lazy ssr:false chunk paints
// a beat late, during which the only visible "Continue Plan" is the site-wide
// BillingPausedBanner, whose resume handler refreshes in place without leaving
// the tab; a fast click landed there instead of the subscription action.
import SubscriptionTab from './SubscriptionTab';

const OverviewTab = dynamic(() => import('./OverviewTab'), { ssr: false });
const BillingHistoryTab = dynamic(() => import('./BillingHistoryTab'), { ssr: false });
const PaymentMethodTab = dynamic(() => import('./PaymentMethodTab'), { ssr: false });

interface BillingPageProps {
  staffCount: string | null;
  currentPlan: string | null;
  /** Live Stripe-derived plan prices, keyed by plan and cycle. */
  planPrices: PlanPriceMap;
  /** Whether a plan change would swap the live Stripe subscription in place. */
  hasLiveSubscription?: boolean;
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
  staffCount,
  currentPlan,
  planPrices,
  hasLiveSubscription = false,
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
    <div className="min-h-full bg-background-secondary px-4 py-6 md:px-10 md:py-8">
      <div className="mb-6">
        <h1 className="mb-1 text-2xl font-bold text-foreground">Billing &amp; Subscription</h1>
        <p className="text-sm text-text-secondary">
          Manage your subscription plan, billing history, and payment methods.
        </p>
      </div>

      <div className="mb-7 flex gap-0 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={cn(
              'cursor-pointer whitespace-nowrap border-b-2 px-5 py-3 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-primary',
            )}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <OverviewTab onChangeTab={handleTabChange} refreshKey={overviewRefreshKey} />
      )}
      {activeTab === 'billing-history' && <BillingHistoryTab />}
      {activeTab === 'subscription' && (
        <SubscriptionTab
          orgStaffCount={parseInt(staffCount ?? '0', 10)}
          currentPlan={currentPlan}
          planPrices={planPrices}
          hasLiveSubscription={hasLiveSubscription}
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
