'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BILLING_PLANS } from '@/lib/billing-plans';
import {
  Users,
  RefreshCw,
  Calendar,
  FileText,
  AlertTriangle,
  ChevronRight,
  Loader2,
  PauseCircle,
  Play,
  BadgePercent,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { getPauseState } from '@/lib/billing';

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
  pausedAt: string | null;
  pauseEndsAt: string | null;
  discountPromoCode: string | null;
  discountCouponName: string | null;
  discountPercentOff: number | null;
  discountAmountOff: number | null;
  discountCurrency: string | null;
  discountDuration: string | null;
  discountEndsAt: string | null;
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
      return 'bg-success/15 text-success';
    case 'open':
    case 'pending':
      return 'bg-warning/15 text-warning';
    case 'failed':
    case 'uncollectible':
      return 'bg-error/15 text-error';
    case 'void':
      return 'bg-muted text-text-secondary';
    case 'canceled':
      return 'bg-muted text-text-secondary';
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

// Human-readable label for the active Stripe discount, or null when there is no
// live discount. A `discountEndsAt` in the past is treated as no discount to
// cover the window between expiry and the clearing webhook.
function getActiveDiscountLabel(sub: Subscription): string | null {
  const hasDiscount = sub.discountPercentOff !== null || sub.discountAmountOff !== null;
  if (!hasDiscount) return null;
  if (sub.discountEndsAt && new Date(sub.discountEndsAt).getTime() < Date.now()) return null;

  const amount =
    sub.discountPercentOff !== null
      ? `${sub.discountPercentOff}% off`
      : `${formatAmount(sub.discountAmountOff ?? 0, sub.discountCurrency ?? 'usd')} off`;

  if (sub.discountDuration === 'repeating') {
    return sub.discountEndsAt ? `${amount} until ${formatDate(sub.discountEndsAt)}` : amount;
  }
  if (sub.discountDuration === 'once') {
    return `${amount} on your next invoice`;
  }
  return amount;
}

interface Props {
  onChangeTab: (tab: Tab) => void;
  /** Bumped by a sibling tab's mutation to force a refetch of overview data. */
  refreshKey?: number;
}

const cardClass = 'rounded-xl border border-border bg-background p-6';
const cardTitleClass = 'text-[11px] font-bold uppercase tracking-[0.6px] text-primary';
const planLinkClass =
  'inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-primary hover:underline';

export default function OverviewTab({ onChangeTab, refreshKey }: Props) {
  const router = useRouter();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

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
  }, [fetchOverview, refreshKey]);

  const handleResume = useCallback(async () => {
    setResuming(true);
    setResumeError(null);
    try {
      const res = await fetch('/api/billing/subscription/resume', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to resume subscription');
      await fetchOverview();
      router.refresh();
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setResuming(false);
    }
  }, [fetchOverview, router]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-sm text-text-tertiary">
        <Loader2 className="size-7 animate-spin text-primary" aria-hidden="true" />
        <span>Loading overview...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-[13px] text-error">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { subscription, activeStaffCount, defaultPaymentMethod, recentInvoices } = data;

  const staffMax = subscription
    ? (BILLING_PLANS.find((p) => p.key === subscription.plan)?.staffMax ?? null)
    : null;
  const usagePct = staffMax ? Math.min((activeStaffCount / staffMax) * 100, 100) : 0;
  const isNearLimit = staffMax !== null && activeStaffCount / staffMax >= 0.8;

  const pauseState = getPauseState(subscription);
  const isPaused = pauseState !== 'none';

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className={cardClass}>
        <div className="mb-4 flex items-center justify-between">
          <p className={cardTitleClass}>Current Plan</p>
          <button className={planLinkClass} onClick={() => onChangeTab('subscription')}>
            Change plan
          </button>
        </div>
        {subscription ? (
          <>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <p className="text-xl font-bold text-foreground">
                {getPlanDisplayName(subscription.plan)}
              </p>
              {isPaused && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                    pauseState === 'expired'
                      ? 'bg-error/15 text-error'
                      : 'bg-warning/15 text-warning',
                  )}
                >
                  <PauseCircle size={13} aria-hidden="true" />
                  {pauseState === 'expired' ? 'Pause ended' : 'Paused'}
                </span>
              )}
            </div>
            <ul className="mt-4 flex flex-col gap-3">
              <li className="flex items-center gap-3 text-sm text-text-secondary">
                <Users size={18} className="shrink-0 text-text-secondary" />
                {staffMax ? `1-${staffMax}` : 'Unlimited'} staff members
              </li>
              <li className="flex items-center gap-3 text-sm text-text-secondary">
                <RefreshCw size={18} className="shrink-0 text-text-secondary" />
                {subscription.billingCycle.charAt(0).toUpperCase() +
                  subscription.billingCycle.slice(1)}{' '}
                billing cycle
              </li>
              {getActiveDiscountLabel(subscription) && (
                <li className="flex items-center gap-3 text-sm text-text-secondary">
                  <BadgePercent size={18} className="shrink-0 text-success" />
                  <span>
                    <span className="font-medium text-foreground">
                      {subscription.discountPromoCode ??
                        subscription.discountCouponName ??
                        'Discount'}
                    </span>{' '}
                    — {getActiveDiscountLabel(subscription)}
                  </span>
                </li>
              )}
              {!subscription.cancelAtPeriodEnd && !isPaused && (
                <li className="flex items-center gap-3 text-sm text-text-secondary">
                  <Calendar size={18} className="shrink-0 text-text-secondary" />
                  Next invoice on {formatDate(subscription.currentPeriodEnd)}
                </li>
              )}
            </ul>
            {subscription.cancelAtPeriodEnd && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
                <AlertTriangle size={18} />
                Cancels on {formatDate(subscription.currentPeriodEnd)}
              </div>
            )}

            {isPaused && (
              <div
                className={cn(
                  'mt-4 rounded-lg border p-4',
                  pauseState === 'expired'
                    ? 'border-error/40 bg-error/5'
                    : 'border-border bg-background-secondary',
                )}
              >
                <p className="text-sm font-semibold text-foreground">
                  {pauseState === 'expired'
                    ? 'Your pause has ended'
                    : 'Your subscription is paused'}
                </p>
                <p className="mt-1 text-[13px] text-text-secondary">
                  {pauseState === 'expired'
                    ? 'Continue your plan to restore access, or cancel your subscription.'
                    : subscription.pauseEndsAt
                      ? `All your data is safely stored. Paused until ${formatDate(subscription.pauseEndsAt)}.`
                      : 'All your data is safely stored until you continue your plan.'}
                </p>

                {resumeError && (
                  <p className="mt-2 text-[13px] text-error" role="alert">
                    {resumeError}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2.5">
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                    disabled={resuming}
                    onClick={() => void handleResume()}
                  >
                    {resuming ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="size-4" aria-hidden="true" />
                    )}
                    Continue Plan
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-background-secondary disabled:opacity-60"
                    disabled={resuming}
                    onClick={() => router.push('/dashboard/billing/cancel')}
                  >
                    Cancel Plan
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-text-secondary">
            <h3 className="mb-2 text-lg font-semibold text-foreground">No active plan</h3>
            <p className="text-sm">Choose a plan to get started.</p>
            <button
              className={cn(planLinkClass, 'mt-3')}
              onClick={() => onChangeTab('subscription')}
            >
              View plans
            </button>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <div className="mb-4 flex items-center justify-between">
          <p className={cardTitleClass}>Staff Usage</p>
          <button className={planLinkClass} onClick={() => onChangeTab('subscription')}>
            Upgrade plan
          </button>
        </div>
        <p className="mb-2.5 text-[13px] text-text-secondary">
          <strong className="text-xl font-bold text-foreground">{activeStaffCount}</strong>
          {staffMax !== null ? ` / ${staffMax}` : ''} active
        </p>
        {staffMax !== null && (
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500',
                isNearLimit ? 'bg-error' : 'bg-primary',
              )}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        )}
        {isNearLimit && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[13px] text-warning">
            <AlertTriangle size={18} />
            Staff limit almost reached. Consider upgrading soon.
          </div>
        )}
      </div>

      <div className={cardClass}>
        <div className="mb-4 flex items-center justify-between">
          <p className={cn(cardTitleClass, 'text-text-tertiary')}>Payment Method</p>
          <button className={planLinkClass} onClick={() => onChangeTab('payment-method')}>
            Update payment
          </button>
        </div>
        {defaultPaymentMethod ? (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold uppercase tracking-[0.5px] text-primary">
                {defaultPaymentMethod.brand}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {defaultPaymentMethod.brand.charAt(0).toUpperCase() +
                    defaultPaymentMethod.brand.slice(1)}{' '}
                  •••• {defaultPaymentMethod.last4}
                </p>
                <span className="text-xs text-text-secondary">
                  Expires {String(defaultPaymentMethod.expMonth).padStart(2, '0')}/
                  {defaultPaymentMethod.expYear}
                </span>
              </div>
            </div>
            {defaultPaymentMethod.billingAddress.name && (
              <p className="mt-3 text-xs text-text-secondary">
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
            <EmptyTableState message="No payment method on file." />
            <button className={planLinkClass} onClick={() => onChangeTab('payment-method')}>
              Add payment method
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className={cardClass}>
        <div className="mb-4 flex items-center justify-between">
          <p className={cn(cardTitleClass, 'text-text-tertiary')}>Recent Invoices</p>
          <button className={planLinkClass} onClick={() => onChangeTab('billing-history')}>
            View all invoices
          </button>
        </div>
        {recentInvoices.length === 0 ? (
          <EmptyTableState message="No invoices yet." />
        ) : (
          <>
            {recentInvoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between border-b border-border py-2.5 text-[13px] last-of-type:border-b-0"
              >
                <span className="font-medium text-primary">
                  <FileText
                    size={16}
                    className="mr-2 inline-block align-middle text-text-tertiary"
                  />
                  {inv.invoiceNumber}
                </span>
                <span className="text-text-secondary">{formatDate(inv.createdAt)}</span>
                <span className="font-medium text-foreground">
                  {formatAmount(inv.amountPaid, inv.currency)}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.4px]',
                    getStatusBadgeClass(inv.status),
                  )}
                >
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
