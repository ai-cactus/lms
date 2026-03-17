'use client';

import React, { useEffect, useState, useCallback } from 'react';
import styles from './billing.module.css';
import { BILLING_PLANS } from '@/lib/billing-plans';

type Tab = 'overview' | 'billing-history' | 'subscription' | 'payment-method';

interface RecentInvoice {
  id: string;
  invoiceNumber: string;
  amountPaid: number;
  currency: string;
  status: string;
  invoiceUrl: string | null;
  pdfUrl: string | null;
  createdAt: string;
}

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  billingAddress: {
    name: string | null;
    line1: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  };
}

interface Subscription {
  plan: string;
  billingCycle: string;
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

interface OverviewData {
  organization: { name: string; staffCount: string | null };
  subscription: Subscription | null;
  activeStaffCount: number;
  defaultPaymentMethod: PaymentMethod | null;
  recentInvoices: RecentInvoice[];
}

function getStatusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'paid':
      return styles.badgePaid;
    case 'open':
    case 'pending':
      return styles.badgePending;
    case 'failed':
    case 'uncollectible':
      return styles.badgeFailed;
    case 'void':
      return styles.badgeVoid;
    case 'canceled':
      return styles.badgeCanceled;
    default:
      return '';
  }
}

function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getPlanDisplayName(planKey: string): string {
  const plan = BILLING_PLANS.find((p) => p.key === planKey);
  return plan ? `${plan.name} Plan` : planKey;
}

interface Props {
  onChangeTab: (tab: Tab) => void;
}

export default function OverviewTab({ onChangeTab }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/billing/overview');
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to load billing overview');
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.spinner} />
        <span>Loading overview...</span>
      </div>
    );
  }

  if (error) {
    return <div className={styles.errorBanner}>{error}</div>;
  }

  if (!data) return null;

  const { subscription, activeStaffCount, defaultPaymentMethod, recentInvoices } = data;

  const staffMax = subscription
    ? (BILLING_PLANS.find((p) => p.key === subscription.plan)?.staffMax ?? null)
    : null;
  const usagePct = staffMax ? Math.min((activeStaffCount / staffMax) * 100, 100) : 0;
  const isNearLimit = staffMax !== null && activeStaffCount / staffMax >= 0.8;

  return (
    <div className={styles.overviewGrid}>
      {/* Current Plan */}
      <div className={styles.card}>
        <p className={styles.cardTitle}>Current Plan</p>
        {subscription ? (
          <>
            <p className={styles.planName}>{getPlanDisplayName(subscription.plan)}</p>
            <p className={styles.planMeta}>
              {subscription.billingCycle.charAt(0).toUpperCase() +
                subscription.billingCycle.slice(1)}{' '}
              billing cycle
            </p>
            {!subscription.cancelAtPeriodEnd && (
              <p className={styles.planMeta}>
                Next Invoice: <strong>{formatDate(subscription.currentPeriodEnd)}</strong>
              </p>
            )}
            {subscription.cancelAtPeriodEnd && (
              <div className={styles.cancelScheduled}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Cancels on {formatDate(subscription.currentPeriodEnd)}
              </div>
            )}
            <button className={styles.planLink} onClick={() => onChangeTab('subscription')}>
              Change plan
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        ) : (
          <div className={styles.noSubscription}>
            <h3>No active plan</h3>
            <p>Choose a plan to get started.</p>
            <button
              className={`${styles.planLink} ${styles.planCardBtnPrimary}`}
              style={{ marginTop: 12 }}
              onClick={() => onChangeTab('subscription')}
            >
              View plans
            </button>
          </div>
        )}
      </div>

      {/* Staff Usage */}
      <div className={styles.card}>
        <p className={styles.cardTitle}>Staff Usage</p>
        <p className={styles.staffNumbers}>
          <strong>{activeStaffCount}</strong>
          {staffMax !== null ? ` / ${staffMax}` : ''} active
        </p>
        {staffMax !== null && (
          <div className={styles.progressBar}>
            <div
              className={`${styles.progressFill} ${isNearLimit ? styles.progressFillDanger : ''}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        )}
        {isNearLimit && (
          <div className={styles.alertBanner}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Staff limit almost reached. Consider upgrading soon.
          </div>
        )}
        <button className={styles.planLink} onClick={() => onChangeTab('subscription')}>
          Upgrade plan
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Payment Method */}
      <div className={styles.card}>
        <p className={styles.cardTitle}>Payment Method</p>
        {defaultPaymentMethod ? (
          <>
            <div className={styles.paymentRow}>
              <div className={styles.cardBrand}>{defaultPaymentMethod.brand}</div>
              <div className={styles.paymentInfo}>
                <p>
                  {defaultPaymentMethod.brand.charAt(0).toUpperCase() +
                    defaultPaymentMethod.brand.slice(1)}{' '}
                  •••• {defaultPaymentMethod.last4}
                </p>
                <span>
                  Expires {String(defaultPaymentMethod.expMonth).padStart(2, '0')}/
                  {defaultPaymentMethod.expYear}
                </span>
              </div>
            </div>
            {defaultPaymentMethod.billingAddress.name && (
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
                {defaultPaymentMethod.billingAddress.name}
                {defaultPaymentMethod.billingAddress.line1 && (
                  <>
                    <br />
                    {defaultPaymentMethod.billingAddress.line1}
                  </>
                )}
                {defaultPaymentMethod.billingAddress.city && (
                  <>
                    <br />
                    {defaultPaymentMethod.billingAddress.city},{' '}
                    {defaultPaymentMethod.billingAddress.state}{' '}
                    {defaultPaymentMethod.billingAddress.country}
                  </>
                )}
              </p>
            )}
            <button className={styles.planLink} onClick={() => onChangeTab('payment-method')}>
              Update payment
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>
              No payment method on file.
            </p>
            <button className={styles.planLink} onClick={() => onChangeTab('payment-method')}>
              Add payment method
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Recent Invoices */}
      <div className={styles.card}>
        <p className={styles.cardTitle}>Recent Invoices</p>
        {recentInvoices.length === 0 ? (
          <p style={{ fontSize: 14, color: '#64748b' }}>No invoices yet.</p>
        ) : (
          <>
            {recentInvoices.map((inv) => (
              <div key={inv.id} className={styles.invoiceRow}>
                <span className={styles.invoiceId}>{inv.invoiceNumber}</span>
                <span className={styles.invoiceDate}>{formatDate(inv.createdAt)}</span>
                <span className={styles.invoiceAmount}>
                  {formatAmount(inv.amountPaid, inv.currency)}
                </span>
                <span className={`${styles.badge} ${getStatusBadgeClass(inv.status)}`}>
                  {inv.status}
                </span>
              </div>
            ))}
            <button
              className={styles.planLink}
              style={{ marginTop: 12 }}
              onClick={() => onChangeTab('billing-history')}
            >
              View all invoices
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
