'use client';

import React, { useState, useEffect } from 'react';
import styles from './billing.module.css';

type Tab = 'overview' | 'billing-history' | 'subscription' | 'payment-method';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'billing-history', label: 'Billing History' },
  { key: 'subscription', label: 'Subscription' },
  { key: 'payment-method', label: 'Payment Method' },
];

// Lazy-loaded tab components
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const OverviewTab = dynamic(() => import('./OverviewTab'), { ssr: false });
const BillingHistoryTab = dynamic(() => import('./BillingHistoryTab'), { ssr: false });
const SubscriptionTab = dynamic(() => import('./SubscriptionTab'), { ssr: false });
const PaymentMethodTab = dynamic(() => import('./PaymentMethodTab'), { ssr: false });

interface BillingPageProps {
  /** Staff count string from the organization (e.g. "23") */
  staffCount: string | null;
  initialTab?: Tab;
}

export default function BillingPage({ staffCount, initialTab = 'overview' }: BillingPageProps) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;

  // Resolve the starting tab directly without needing an effect
  const startingTab = tabParam && TABS.some((t) => t.key === tabParam) ? tabParam : initialTab;
  const [activeTab, setActiveTab] = useState<Tab>(startingTab);

  return (
    <div className={styles.billingPage}>
      <div className={styles.pageHeader}>
        <h1>Billing &amp; Subscription</h1>
        <p>Manage your subscription plan, billing history, and payment methods.</p>
      </div>

      {/* Tab Navigation */}
      <div className={styles.tabs} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      {activeTab === 'overview' && <OverviewTab onChangeTab={setActiveTab} />}
      {activeTab === 'billing-history' && <BillingHistoryTab />}
      {activeTab === 'subscription' && (
        <SubscriptionTab
          orgStaffCount={parseInt(staffCount ?? '0', 10)}
          onChangeTab={setActiveTab}
        />
      )}
      {activeTab === 'payment-method' && <PaymentMethodTab />}
    </div>
  );
}
