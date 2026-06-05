'use client';

import React, { useEffect, useState, useCallback } from 'react';
import styles from './billing.module.css';
import { BILLING_PLANS } from '@/lib/billing-plans';
import { Users, RefreshCw, Calendar, FileText, AlertTriangle } from 'lucide-react';

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
    <div className={styles.overviewGridNew}>
      {/* Current Plan */}
      <div className={styles.card}>
        <div className={styles.cardHeaderFlex}>
          <p className={styles.cardTitle}>Current Plan</p>
          <button className={styles.planLink} onClick={() => onChangeTab('subscription')}>
            Change plan
          </button>
        </div>
        {subscription ? (
          <>
            <p className={styles.planName}>{getPlanDisplayName(subscription.plan)}</p>
            <ul className={styles.currentPlanList}>
              <li>
                <Users size={18} />
                {staffMax ? `1-${staffMax}` : 'Unlimited'} staff members
              </li>
              <li>
                <RefreshCw size={18} />
                {subscription.billingCycle.charAt(0).toUpperCase() +
                  subscription.billingCycle.slice(1)}{' '}
                billing cycle
              </li>
              {!subscription.cancelAtPeriodEnd && (
                <li>
                  <Calendar size={18} />
                  Next invoice on {formatDate(subscription.currentPeriodEnd)}
                </li>
              )}
            </ul>
            {subscription.cancelAtPeriodEnd && (
              <div className={styles.cancelScheduled}>
                <AlertTriangle size={18} />
                Cancels on {formatDate(subscription.currentPeriodEnd)}
              </div>
            )}
          </>
        ) : (
          <div className={styles.noSubscription}>
            <h3>No active plan</h3>
            <p>Choose a plan to get started.</p>
            <button
              className={`${styles.planLink}`}
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
        <div className={styles.cardHeaderFlex}>
          <p className={styles.cardTitle}>Staff Usage</p>
          <button className={styles.planLink} onClick={() => onChangeTab('subscription')}>
            Upgrade plan
          </button>
        </div>
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
            <AlertTriangle size={18} />
            Staff limit almost reached. Consider upgrading soon.
          </div>
        )}
      </div>

      {/* Payment Method */}
      <div className={styles.card}>
        <div className={styles.cardHeaderFlex}>
          <p className={styles.cardTitle} style={{ color: '#94a3b8' }}>
            Payment Method
          </p>
          <button className={styles.planLink} onClick={() => onChangeTab('payment-method')}>
            Update payment
          </button>
        </div>
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
        <div className={styles.cardHeaderFlex}>
          <p className={styles.cardTitle} style={{ color: '#94a3b8' }}>
            Recent Invoices
          </p>
          <button className={styles.planLink} onClick={() => onChangeTab('billing-history')}>
            View all invoices
          </button>
        </div>
        {recentInvoices.length === 0 ? (
          <p style={{ fontSize: 14, color: '#64748b' }}>No invoices yet.</p>
        ) : (
          <>
            {recentInvoices.map((inv) => (
              <div key={inv.id} className={styles.invoiceRow}>
                <span className={styles.invoiceId}>
                  <FileText
                    size={16}
                    style={{ color: '#94a3b8', marginRight: '8px', verticalAlign: 'middle' }}
                  />
                  {inv.invoiceNumber}
                </span>
                <span className={styles.invoiceDate}>{formatDate(inv.createdAt)}</span>
                <span className={styles.invoiceAmount}>
                  {formatAmount(inv.amountPaid, inv.currency)}
                </span>
                <span className={`${styles.badge} ${getStatusBadgeClass(inv.status)}`}>
                  {inv.status}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
