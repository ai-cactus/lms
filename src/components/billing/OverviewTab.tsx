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
import { getPauseState, hasPendingPause } from '@/lib/billing';

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
  /** ISO timestamp a REQUESTED pause takes effect, or null. Full access until then. */
  pauseStartsAt: string | null;
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
      return 'bg-[#d1fae5] text-[#047857]';
    case 'open':
    case 'pending':
      return 'bg-[#fef3c7] text-[#b45309]';
    case 'failed':
    case 'uncollectible':
      return 'bg-[#fee2e2] text-[#b91c1c]';
    case 'void':
      return 'bg-[#f1f5f9] text-[#475569]';
    case 'canceled':
      return 'bg-[#f1f5f9] text-[#475569]';
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

const cardClass =
  'flex flex-col rounded-[12px] border border-[#e2e8f0] bg-white p-[25px] shadow-[0px_1px_1px_0px_rgba(0,0,0,0.05)]';
const cardTitleClass =
  'text-[12px] leading-[16px] font-bold uppercase tracking-[0.6px] text-primary';
const planLinkClass =
  'inline-flex cursor-pointer items-center gap-1 text-[14px] leading-[20px] font-bold text-primary hover:underline';
const listItemClass = 'flex items-center gap-2 text-[14px] leading-[20px] text-[#475569]';
const listIconClass = 'size-[14px] shrink-0 text-[#475569]';

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
  const pendingPause = hasPendingPause(subscription);

  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className={cardClass}>
          <div className="flex items-start justify-between pb-1">
            <p className={cardTitleClass}>Current Plan</p>
            <button className={planLinkClass} onClick={() => onChangeTab('subscription')}>
              Change plan
            </button>
          </div>
          {subscription ? (
            <>
              <div className="flex flex-wrap items-center gap-2 pb-4">
                <p className="text-[20px] leading-[28px] font-bold text-[#0f172a]">
                  {getPlanDisplayName(subscription.plan)}
                </p>
                {isPaused && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                      pauseState === 'expired'
                        ? 'bg-[#fee2e2] text-[#b91c1c]'
                        : 'bg-[#fef3c7] text-[#b45309]',
                    )}
                  >
                    <PauseCircle size={13} aria-hidden="true" />
                    {pauseState === 'expired' ? 'Pause ended' : 'Paused'}
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                <li className={listItemClass}>
                  <Users className={listIconClass} aria-hidden="true" />
                  {staffMax ? `1-${staffMax}` : 'Unlimited'} staff members
                </li>
                <li className={listItemClass}>
                  <RefreshCw className={listIconClass} aria-hidden="true" />
                  {subscription.billingCycle.charAt(0).toUpperCase() +
                    subscription.billingCycle.slice(1)}{' '}
                  billing cycle
                </li>
                {getActiveDiscountLabel(subscription) && (
                  <li className={listItemClass}>
                    <BadgePercent
                      className={cn(listIconClass, 'text-[#059669]')}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="font-bold text-[#0f172a]">
                        {subscription.discountPromoCode ??
                          subscription.discountCouponName ??
                          'Discount'}
                      </span>{' '}
                      — {getActiveDiscountLabel(subscription)}
                    </span>
                  </li>
                )}
                {!subscription.cancelAtPeriodEnd && !isPaused && (
                  <li className={cn(listItemClass, 'border-t border-[#f1f5f9] pt-[9px]')}>
                    <Calendar className={listIconClass} aria-hidden="true" />
                    Next invoice on {formatDate(subscription.currentPeriodEnd)}
                  </li>
                )}
              </ul>
              {subscription.cancelAtPeriodEnd && (
                <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-[#fde68a] bg-[#fffbeb] p-[13px] text-[12px] leading-[16px] font-medium text-[#92400e]">
                  <AlertTriangle className="size-[18px] shrink-0" aria-hidden="true" />
                  Cancels on {formatDate(subscription.currentPeriodEnd)}
                </div>
              )}

              {pendingPause && subscription.pauseStartsAt && (
                <div className="mt-3 rounded-[8px] border border-[#fde68a] bg-[#fffbeb] p-[13px]">
                  <p className="flex items-center gap-2 text-[12px] leading-[16px] font-semibold text-[#92400e]">
                    <PauseCircle className="size-[18px] shrink-0" aria-hidden="true" />
                    Pauses on {formatDate(subscription.pauseStartsAt)}
                  </p>
                  <p className="mt-1 text-[12px] leading-[16px] text-[#92400e]">
                    You keep full access until then. Manage this from the Subscription tab.
                  </p>
                </div>
              )}

              {isPaused && (
                <div
                  className={cn(
                    'mt-4 rounded-[8px] border p-4',
                    pauseState === 'expired'
                      ? 'border-[#fecaca] bg-[#fef2f2]'
                      : 'border-[#e2e8f0] bg-[#f8fafc]',
                  )}
                >
                  <p className="text-[14px] leading-[20px] font-bold text-[#0f172a]">
                    {pauseState === 'expired'
                      ? 'Your pause has ended'
                      : 'Your subscription is paused'}
                  </p>
                  <p className="mt-1 text-[14px] leading-[20px] text-[#475569]">
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
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-[14px] leading-[20px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
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
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#e2e8f0] px-4 py-2 text-[14px] leading-[20px] font-semibold text-[#0f172a] transition-colors hover:bg-[#f8fafc] disabled:opacity-60"
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
            <div className="rounded-[8px] border border-dashed border-[#e2e8f0] p-10 text-center">
              <h3 className="mb-2 text-[20px] leading-[28px] font-bold text-[#0f172a]">
                No active plan
              </h3>
              <p className="text-[14px] leading-[20px] text-[#475569]">
                Choose a plan to get started.
              </p>
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
          <div className="flex items-start justify-between pb-4">
            <div className="flex flex-col gap-1">
              <p className={cn(cardTitleClass, 'text-[#64748b]')}>Staff Usage</p>
              <p className="text-[14px] leading-[20px] text-[#64748b]">
                <strong className="text-[24px] leading-[32px] font-black text-[#0f172a]">
                  {activeStaffCount}
                </strong>
                {staffMax !== null ? ` / ${staffMax}` : ''} active
              </p>
            </div>
            <button className={planLinkClass} onClick={() => onChangeTab('subscription')}>
              Upgrade plan
            </button>
          </div>
          {staffMax !== null && (
            <div className="mb-4 h-[10px] overflow-hidden rounded-full bg-[#f1f5f9]">
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
            <div className="flex items-center gap-2 rounded-[8px] border border-[#fde68a] bg-[#fffbeb] p-[13px] text-[12px] leading-[16px] font-medium text-[#92400e]">
              <AlertTriangle className="size-[18px] shrink-0" aria-hidden="true" />
              Staff limit almost reached. Consider upgrading soon.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
        <div className={cardClass}>
          <div className="flex items-start justify-between gap-4 pb-6">
            <div className="flex items-center gap-4">
              {defaultPaymentMethod && (
                <div className="flex h-[32px] w-[48px] shrink-0 items-center justify-center rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] text-[10px] font-bold tracking-[0.5px] uppercase text-[#475569]">
                  {defaultPaymentMethod.brand.slice(0, 4)}
                </div>
              )}
              <div>
                {defaultPaymentMethod ? (
                  <>
                    <p className="text-[14px] leading-[20px] font-bold text-[#0f172a]">
                      {defaultPaymentMethod.brand.charAt(0).toUpperCase() +
                        defaultPaymentMethod.brand.slice(1)}{' '}
                      •••• {defaultPaymentMethod.last4}
                    </p>
                    <span className="text-[12px] leading-[16px] text-[#64748b]">
                      Expires {String(defaultPaymentMethod.expMonth).padStart(2, '0')}/
                      {defaultPaymentMethod.expYear}
                    </span>
                  </>
                ) : (
                  <p className={cn(cardTitleClass, 'text-[#64748b]')}>Payment Method</p>
                )}
              </div>
            </div>
            <button className={planLinkClass} onClick={() => onChangeTab('payment-method')}>
              Update payment
            </button>
          </div>
          {defaultPaymentMethod ? (
            defaultPaymentMethod.billingAddress.name && (
              <div className="flex flex-col gap-1">
                <p className={cn(cardTitleClass, 'text-[#64748b]')}>Billing address</p>
                <p className="text-[14px] leading-[20px] text-[#334155]">
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
              </div>
            )
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
          <div className="flex items-center justify-between pb-4">
            <p className={cn(cardTitleClass, 'text-[#64748b]')}>Recent Invoices</p>
            <button
              className={cn(planLinkClass, 'text-[12px] leading-[16px]')}
              onClick={() => onChangeTab('billing-history')}
            >
              View all invoices
            </button>
          </div>
          {recentInvoices.length === 0 ? (
            <EmptyTableState message="No invoices yet." />
          ) : (
            <div className="flex flex-col gap-3">
              {recentInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 rounded-[8px] border border-[#f1f5f9] p-[13px]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <FileText className="size-4 shrink-0 text-[#64748b]" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] leading-[20px] font-medium text-[#0f172a]">
                        {inv.invoiceNumber}
                      </span>
                      <span className="block text-[12px] leading-[16px] text-[#64748b]">
                        {formatDate(inv.createdAt)}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    <span className="text-[14px] leading-[20px] font-bold text-[#0f172a]">
                      {formatAmount(inv.amountPaid, inv.currency)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-[4px] px-2 py-1 text-[10px] leading-[15px] font-bold uppercase',
                        getStatusBadgeClass(inv.status),
                      )}
                    >
                      {inv.status}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
