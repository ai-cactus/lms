'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BILLING_PLANS, BillingCycle, canSelectPlan } from '@/lib/billing-plans';
import type { PlanPriceMap } from '@/lib/billing-prices';
import type { PlanChangeClassification } from '@/lib/billing-plan-change';
import { getPlanCardPrice, getDiscountPercent, formatCents } from '@/lib/billing-price-format';
import { Flame, Check, Play, AlertTriangle, CalendarClock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { HCaptcha } from '@/components/ui';
import { cn } from '@/lib/utils';
import { MAX_PAUSE_MONTHS, getPauseState } from '@/lib/billing';

type Tab = 'overview' | 'billing-history' | 'subscription' | 'payment-method';

interface Props {
  orgStaffCount: number;
  currentPlan: string | null;
  /** Live Stripe-derived plan prices, keyed by plan and cycle. */
  planPrices: PlanPriceMap;
  /** Whether selecting a plan swaps the live Stripe subscription in place. */
  hasLiveSubscription?: boolean;
  pausedAt?: string | null;
  pauseEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  billingCycle?: string | null;
  currentPeriodEnd?: string | null;
  /** Display name of the plan a pending scheduled change moves to, or null. */
  scheduledPlanName?: string | null;
  /** ISO timestamp when a pending scheduled change takes effect, or null. */
  scheduledEffectiveAt?: string | null;
  onChangeTab: (tab: Tab) => void;
  /** Called after a successful billing mutation so sibling tabs can refetch. */
  onMutated?: () => void;
}

const BILLING_CYCLES: readonly BillingCycle[] = ['monthly', 'quarterly', 'yearly'];

/** Order the cycle toggle is presented in — cheapest-per-month first. */
const CYCLE_DISPLAY_ORDER: readonly BillingCycle[] = ['yearly', 'quarterly', 'monthly'];

function isBillingCycle(value: string | null | undefined): value is BillingCycle {
  return value != null && (BILLING_CYCLES as readonly string[]).includes(value);
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Dropdown option sets ─────────────────────────────────────────────────────

const FACILITY_TYPES = [
  'Behavioral Health (Outpatient/Community)',
  'Residential Treatment Center (RTC)',
  'Substance Use Disorder (SUD) - Residential',
  'Substance Use Disorder (SUD) - Outpatient/MAT',
  'Intellectual/Developmental Disabilities (IDD)',
  'Eating Disorder Treatment Center',
  'Federally Qualified Health Center (FQHC)',
  'Post-Acute / Skilled Nursing (SNF)',
  'Sober Living / Recovery Housing',
  'Other Specialized Healthcare (Custom)',
] as const;

const FACILITY_COUNTS = ['1-5', '6-20', '21+'] as const;

const ACCREDITATION_OPTIONS = [
  'The Joint Commission (TJC)',
  'CARF International',
  'COA (Council on Accreditation)',
  'State-Level Licensing only',
] as const;

const TRAINING_METHODS = ['Self-directed', 'Consultant-led', 'Legacy Software'] as const;

// ── Field styling helpers ────────────────────────────────────────────────────

const labelClass = 'mb-1.5 block text-[13px] font-medium text-text-secondary';
const fieldBaseClass =
  'box-border w-full rounded-[10px] border border-border px-3.5 py-2.5 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/10';
const fieldErrorClass = 'border-error focus:border-error focus:ring-error/10';
const selectExtraClass = 'cursor-pointer appearance-none bg-background bg-no-repeat pr-9';
const requiredMarkClass = 'ml-0.5 text-error';
const fieldErrorTextClass = 'mt-1 block text-xs text-error';
const inputClass = (hasError: boolean) => cn(fieldBaseClass, hasError && fieldErrorClass);
const selectClass = (hasError: boolean) =>
  cn(fieldBaseClass, selectExtraClass, hasError && fieldErrorClass);

const planButtonClass =
  'h-[47px] w-full cursor-pointer rounded-full px-4 text-[16px] leading-[24px] font-semibold transition-colors';
const statusCardClass =
  'mt-6 flex flex-col gap-4 rounded-[12px] border border-[#e2e8f0] bg-white p-[25px] shadow-[0px_1px_1px_0px_rgba(0,0,0,0.05)]';

// ── State types ──────────────────────────────────────────────────────────────

interface EnterpriseFormFields {
  firstName: string;
  lastName: string;
  workEmail: string;
  jobTitle: string;
  organizationName: string;
  facilityType: string;
  facilityTypeOther: string; // shown when facilityType === "Other (Custom)"
  numberOfFacilities: string;
  numberOfStaff: string;
  currentAccreditation: string;
  currentTrainingMethod: string;
  primaryPainPoint: string;
}

interface EnterpriseModalState extends EnterpriseFormFields {
  open: boolean;
  loading: boolean;
  success: boolean;
  error: string | null;
  /** Field-level validation errors */
  fieldErrors: Partial<Record<keyof EnterpriseFormFields, string>>;
}

const EMPTY_FORM: EnterpriseFormFields = {
  firstName: '',
  lastName: '',
  workEmail: '',
  jobTitle: '',
  organizationName: '',
  facilityType: '',
  facilityTypeOther: '',
  numberOfFacilities: '',
  numberOfStaff: '',
  currentAccreditation: '',
  currentTrainingMethod: '',
  primaryPainPoint: '',
};

// ── Validation ───────────────────────────────────────────────────────────────

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validateForm(
  fields: EnterpriseFormFields,
): Partial<Record<keyof EnterpriseFormFields, string>> {
  const errors: Partial<Record<keyof EnterpriseFormFields, string>> = {};

  if (!fields.firstName.trim()) {
    errors.firstName = 'First name is required.';
  }

  if (!fields.lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }

  if (!fields.workEmail.trim()) {
    errors.workEmail = 'Work email is required.';
  } else if (!validateEmail(fields.workEmail)) {
    errors.workEmail = 'Please enter a valid email address.';
  }

  if (!fields.jobTitle.trim()) {
    errors.jobTitle = 'Job title is required.';
  }

  if (!fields.organizationName.trim()) {
    errors.organizationName = 'Organization name is required.';
  }

  if (!fields.facilityType) {
    errors.facilityType = 'Facility type is required.';
  } else if (fields.facilityType === 'Other (Custom)' && !fields.facilityTypeOther.trim()) {
    errors.facilityTypeOther = 'Please specify your facility type.';
  }

  if (!fields.numberOfFacilities) {
    errors.numberOfFacilities = 'Number of facilities is required.';
  }

  if (!fields.numberOfStaff.trim()) {
    errors.numberOfStaff = 'Number of staff is required.';
  }

  if (!fields.currentAccreditation) {
    errors.currentAccreditation = 'Accreditation is required.';
  }

  if (!fields.currentTrainingMethod) {
    errors.currentTrainingMethod = 'Training method is required.';
  }

  if (!fields.primaryPainPoint.trim()) {
    errors.primaryPainPoint = 'Please describe your primary pain point.';
  }

  return errors;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SubscriptionTab({
  orgStaffCount,
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
  onChangeTab,
  onMutated,
}: Props) {
  const router = useRouter();
  const pauseState = getPauseState({ status: null, pausedAt, pauseEndsAt });
  const isPaused = pauseState !== 'none';
  const isCancelScheduled = Boolean(cancelAtPeriodEnd);
  const cancelDateLabel = currentPeriodEnd ? formatLongDate(currentPeriodEnd) : null;
  const billingCycleLabel = billingCycle
    ? billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1)
    : null;
  // Seed the cycle from the current subscription when one exists, so the plan
  // grid reflects what the org is actually billed on; default to yearly for new
  // subscribers.
  const [cycle, setCycle] = useState<BillingCycle>(
    currentPlan && isBillingCycle(billingCycle) ? billingCycle : 'yearly',
  );
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [pendingSwap, setPendingSwap] = useState<{
    planKey: string;
    fromPlanName: string;
    toPlanName: string;
    cycle: BillingCycle;
    classification: PlanChangeClassification;
    effectiveAt: string | null;
    amountDueCents: number | null;
    currency: string | null;
  } | null>(null);
  const [cancelingSchedule, setCancelingSchedule] = useState(false);
  const [cancelScheduleError, setCancelScheduleError] = useState<string | null>(null);

  const [enterpriseModal, setEnterpriseModal] = useState<EnterpriseModalState>({
    ...EMPTY_FORM,
    open: false,
    loading: false,
    success: false,
    error: null,
    fieldErrors: {},
  });

  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [enterpriseCaptchaToken, setEnterpriseCaptchaToken] = useState<string>();

  // ── Checkout ───────────────────────────────────────────────────────────────

  const handleSelectPlan = useCallback(
    async (planKey: string) => {
      if (checkoutLoading) return;
      setCheckoutLoading(planKey);
      setCheckoutError(null);

      try {
        const res = await fetch('/api/billing/subscription/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey, billingCycle: cycle }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? 'Failed to start checkout');
        }

        if (data.url) {
          // New subscription — redirect to Stripe Checkout.
          window.location.href = data.url;
          return;
        }

        // Existing subscription was swapped in place immediately (THER-001), or a
        // change was scheduled for period end — either way there is no redirect.
        // Send the admin to Overview and refresh the server tree so this tab's
        // paused/plan/scheduled banners are fresh on return. `router.refresh()`
        // MUST be deferred past the `router.replace('?tab=overview')` commit:
        // issued synchronously it snapshots the pre-replace path and reasserts
        // `?tab=subscription`, stranding the admin here (Next 16 App Router).
        if (data.updated || data.scheduled) {
          onChangeTab('overview');
          onMutated?.();
          setTimeout(() => router.refresh(), 0);
        }
      } catch (err) {
        setCheckoutError(err instanceof Error ? err.message : 'Unexpected error');
      } finally {
        setCheckoutLoading(null);
      }
    },
    [checkoutLoading, cycle, router, onChangeTab, onMutated],
  );

  // Selecting a plan while a live subscription exists may schedule the change or
  // charge a prorated difference now, so first ask the server to classify the
  // change (and preview any immediate charge) and confirm before committing. New
  // subscribers go straight to Checkout, which already gates the charge.
  const handlePlanCardClick = useCallback(
    async (plan: (typeof BILLING_PLANS)[number]) => {
      if (!hasLiveSubscription) {
        void handleSelectPlan(plan.key);
        return;
      }
      if (previewLoading) return;
      setPreviewLoading(plan.key);
      setCheckoutError(null);
      try {
        const res = await fetch('/api/billing/subscription/preview-plan-change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: plan.key, billingCycle: cycle }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Failed to preview plan change');
        setPendingSwap({
          planKey: plan.key,
          fromPlanName:
            BILLING_PLANS.find((p) => p.key === currentPlan)?.name ?? 'your current plan',
          toPlanName: plan.name,
          cycle,
          classification: data.classification as PlanChangeClassification,
          effectiveAt: typeof data.effectiveAt === 'string' ? data.effectiveAt : null,
          amountDueCents: typeof data.amountDueCents === 'number' ? data.amountDueCents : null,
          currency: typeof data.currency === 'string' ? data.currency : null,
        });
      } catch (err) {
        setCheckoutError(err instanceof Error ? err.message : 'Unexpected error');
      } finally {
        setPreviewLoading(null);
      }
    },
    [hasLiveSubscription, previewLoading, currentPlan, cycle, handleSelectPlan],
  );

  // ── Cancel a pending scheduled plan change ─────────────────────────────────

  const handleCancelScheduledChange = useCallback(async () => {
    setCancelingSchedule(true);
    setCancelScheduleError(null);
    try {
      const res = await fetch('/api/billing/subscription/cancel-scheduled-change', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to cancel scheduled change');
      // Navigate, then defer the refresh past the commit — see handleSelectPlan.
      onChangeTab('overview');
      onMutated?.();
      setTimeout(() => router.refresh(), 0);
    } catch (err) {
      setCancelScheduleError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setCancelingSchedule(false);
    }
  }, [onChangeTab, onMutated, router]);

  // ── Enterprise form field helper ───────────────────────────────────────────

  const setField = useCallback(
    <K extends keyof EnterpriseFormFields>(key: K, value: EnterpriseFormFields[K]) => {
      setEnterpriseModal((s) => ({
        ...s,
        [key]: value,
        fieldErrors: { ...s.fieldErrors, [key]: undefined },
      }));
    },
    [],
  );

  // ── Enterprise submit ──────────────────────────────────────────────────────

  const handleEnterpriseSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      const errors = validateForm(enterpriseModal);
      if (Object.keys(errors).length > 0) {
        setEnterpriseModal((s) => ({ ...s, fieldErrors: errors }));
        return;
      }

      setEnterpriseModal((s) => ({ ...s, loading: true, error: null, fieldErrors: {} }));

      try {
        const resolvedFacilityType =
          enterpriseModal.facilityType === 'Other (Custom)'
            ? enterpriseModal.facilityTypeOther.trim()
            : enterpriseModal.facilityType;

        const res = await fetch('/api/billing/contact-enterprise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: enterpriseModal.firstName.trim(),
            lastName: enterpriseModal.lastName.trim(),
            workEmail: enterpriseModal.workEmail.trim(),
            jobTitle: enterpriseModal.jobTitle.trim(),
            organizationName: enterpriseModal.organizationName.trim(),
            facilityType: resolvedFacilityType,
            numberOfFacilities: enterpriseModal.numberOfFacilities,
            numberOfStaff: enterpriseModal.numberOfStaff.trim(),
            currentAccreditation: enterpriseModal.currentAccreditation,
            currentTrainingMethod: enterpriseModal.currentTrainingMethod,
            primaryPainPoint: enterpriseModal.primaryPainPoint.trim(),
            captchaToken: enterpriseCaptchaToken,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? 'Failed to send inquiry');
        }

        setEnterpriseModal((s) => ({ ...s, loading: false, success: true }));

        // Redirect to dashboard after 2 s so user can read the confirmation
        setTimeout(() => {
          router.push('/dashboard');
        }, 2000);
      } catch (err) {
        setEnterpriseModal((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Unexpected error',
        }));
      }
    },
    [enterpriseModal, enterpriseCaptchaToken, router],
  );

  // ── Resume subscription (Continue Plan) ────────────────────────────────────

  const handleResumeSubscription = useCallback(async () => {
    setResuming(true);
    setResumeError(null);
    try {
      const res = await fetch('/api/billing/subscription/resume', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to resume subscription');
      // Navigate, then defer the refresh past the commit — see handleSelectPlan.
      onChangeTab('overview');
      onMutated?.();
      setTimeout(() => router.refresh(), 0);
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setResuming(false);
    }
  }, [onChangeTab, onMutated, router]);

  // ── Reactivate subscription (clear scheduled cancellation) ─────────────────

  const handleReactivateSubscription = useCallback(async () => {
    setReactivating(true);
    setReactivateError(null);
    try {
      const res = await fetch('/api/billing/subscription/reactivate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to reactivate subscription');
      // Navigate, then defer the refresh past the commit — see handleSelectPlan.
      onChangeTab('overview');
      onMutated?.();
      setTimeout(() => router.refresh(), 0);
    } catch (err) {
      setReactivateError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setReactivating(false);
    }
  }, [onChangeTab, onMutated, router]);

  // ── Billing cycle labels ───────────────────────────────────────────────────

  const cycles = CYCLE_DISPLAY_ORDER;
  const cycleLabels: Record<BillingCycle, string> = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex flex-col items-center gap-[6px] pb-8 text-center">
        <h2 className="text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[35.5px]">
          Select a plan
        </h2>
        <p className="text-[14.8px] leading-[26px] text-[#707070]">
          Select the best plan for your team size and budget — Upgrade or cancel at anytime.
        </p>
      </div>

      {checkoutError && (
        <div className="mb-4 rounded-[8px] border border-error/40 bg-error/10 px-4 py-2.5 text-[13px] text-error">
          {checkoutError}
        </div>
      )}

      <div className="flex flex-col items-center gap-5">
        <div
          className="inline-flex max-w-full gap-[2px] overflow-x-auto rounded-full bg-[rgba(64,64,64,0.08)] p-1"
          role="group"
          aria-label="Billing cycle"
        >
          {cycles.map((c) => (
            <button
              key={c}
              className={cn(
                'cursor-pointer rounded-full px-8 py-[7px] text-[12.9px] leading-[22px] font-semibold tracking-[0.2px] whitespace-nowrap transition-colors',
                cycle === c
                  ? 'bg-background text-[#141414] shadow-[0px_1px_1px_0px_rgba(0,0,0,0.04)]'
                  : 'text-[#717171]',
              )}
              onClick={() => setCycle(c)}
            >
              {cycleLabels[c]}
            </button>
          ))}
        </div>

        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {BILLING_PLANS.map((plan) => {
            const allowed = canSelectPlan(plan, orgStaffCount);
            const cyclePrice = getPlanCardPrice(planPrices[plan.key][cycle]);
            const discountPct = getDiscountPercent(
              planPrices[plan.key].monthly,
              planPrices[plan.key][cycle],
            );
            const isCurrent = currentPlan === plan.key;
            const isDisabled = !allowed && !plan.isEnterprise;
            // The design paints the recommended plan as a solid brand card, unless
            // the org is already subscribed to another plan — then the subscribed
            // card takes the emphasis and every other card stays neutral.
            const isFeatured = !!plan.popular && !currentPlan;

            return (
              <div
                key={plan.key}
                className={cn(
                  'relative flex flex-col gap-4 rounded-[24px] border p-[25px] transition-all',
                  isFeatured && 'border-[#cddfff] bg-primary',
                  isCurrent && 'border-primary bg-[#eff1ff]',
                  !isFeatured && !isCurrent && 'border-[#e2e8f0] bg-white',
                  !isCurrent && !isDisabled && !isFeatured && 'hover:border-primary',
                  isDisabled && 'pointer-events-none cursor-not-allowed opacity-50',
                )}
                aria-disabled={isDisabled}
              >
                <div className="flex flex-col gap-[5px]">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={cn(
                        'text-[21.1px] leading-[30px] font-semibold',
                        isFeatured ? 'text-white' : 'text-[#141414]',
                      )}
                    >
                      {plan.name}
                    </p>
                    {plan.popular && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-primary bg-[#f2f3ff] px-2 py-1 text-[11.8px] leading-[16px] tracking-[0.2px] text-primary">
                        <Flame className="size-4" aria-hidden="true" />
                        Popular
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      // Fixed 3-line slot so the price row and Subscribe button sit at
                      // the same height on every card regardless of description length.
                      'min-h-[66px] text-[15.1px] leading-[22px] tracking-[0.2px]',
                      isFeatured ? 'text-[#e6eaff]' : 'text-[#707070]',
                    )}
                  >
                    {plan.description}
                  </p>
                </div>

                <div className="flex items-end gap-2">
                  {plan.isEnterprise ? (
                    <span
                      className={cn(
                        'text-[33.4px] leading-[48px] font-semibold tracking-[-0.4px]',
                        isFeatured ? 'text-white' : 'text-[#141414]',
                      )}
                    >
                      Custom
                    </span>
                  ) : cyclePrice === null ? (
                    <span
                      className={cn(
                        'text-[18px] leading-[48px] font-semibold',
                        isFeatured ? 'text-[#e6eaff]' : 'text-[#94a3b8]',
                      )}
                    >
                      Price unavailable
                    </span>
                  ) : (
                    <>
                      <span
                        className={cn(
                          'text-[33.4px] leading-[48px] font-semibold tracking-[-0.4px]',
                          isFeatured ? 'text-white' : 'text-[#141414]',
                        )}
                      >
                        ${cyclePrice}
                      </span>
                      <span
                        className={cn(
                          'pb-[11px] text-[11.8px] leading-[16px] tracking-[0.2px]',
                          isFeatured ? 'text-[#e6eaff]' : 'text-[#707070]',
                        )}
                      >
                        /mo
                        {cycle !== 'monthly'
                          ? ` (billed ${cycle}${
                              discountPct !== null && discountPct > 0
                                ? ` — save ${discountPct}%`
                                : ''
                            })`
                          : ''}
                      </span>
                    </>
                  )}
                </div>

                {plan.isEnterprise ? (
                  <button
                    id={`plan-btn-${plan.key}`}
                    className={cn(
                      planButtonClass,
                      currentPlan
                        ? 'border border-[#cddfff] bg-white text-primary hover:bg-primary/5'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90',
                    )}
                    onClick={() =>
                      setEnterpriseModal((s) => ({
                        ...s,
                        ...EMPTY_FORM,
                        open: true,
                        success: false,
                        error: null,
                        fieldErrors: {},
                      }))
                    }
                  >
                    Contact sales
                  </button>
                ) : (
                  <button
                    id={`plan-btn-${plan.key}`}
                    className={cn(
                      planButtonClass,
                      isCurrent
                        ? 'cursor-default bg-[#e2e8f0] text-[#64748b]'
                        : isFeatured
                          ? 'bg-white text-primary hover:bg-white/90'
                          : currentPlan
                            ? 'border border-[#cddfff] bg-white text-primary hover:bg-primary/5'
                            : 'bg-primary text-primary-foreground hover:bg-primary/90',
                    )}
                    disabled={
                      isCurrent ||
                      !allowed ||
                      checkoutLoading === plan.key ||
                      previewLoading === plan.key
                    }
                    onClick={() => void handlePlanCardClick(plan)}
                  >
                    {checkoutLoading === plan.key
                      ? hasLiveSubscription
                        ? 'Updating plan...'
                        : 'Redirecting...'
                      : previewLoading === plan.key
                        ? 'Loading...'
                        : isCurrent
                          ? 'Current Plan'
                          : 'Subscribe'}
                  </button>
                )}

                <div className="flex flex-col">
                  <p
                    className={cn(
                      'pb-2 text-[10px] font-bold tracking-[0.8px] uppercase',
                      isFeatured ? 'text-[#c7cffd]' : 'text-[#94a3b8]',
                    )}
                  >
                    {plan.featuresLabel}
                  </p>
                  <ul className="flex flex-col">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className={cn(
                          'flex items-center gap-2 py-1 text-[15.1px] leading-[22px] tracking-[0.2px]',
                          isFeatured ? 'text-[#e6eaff]' : 'text-[#646464]',
                        )}
                      >
                        <Check
                          className={cn(
                            'size-5 shrink-0',
                            isFeatured ? 'text-white' : 'text-primary',
                          )}
                          aria-hidden="true"
                        />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {scheduledPlanName && scheduledEffectiveAt && (
        <div className={statusCardClass}>
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-base font-semibold text-foreground">Plan change scheduled</h3>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3.5 py-2.5 text-[13px] text-primary">
                <CalendarClock size={18} aria-hidden="true" />
                Changing to {scheduledPlanName} on {formatLongDate(scheduledEffectiveAt)}
              </div>
              <p className="mt-3 text-sm text-text-secondary">
                Your current plan stays active until then — no charge today. Cancel the scheduled
                change to keep your current plan.
              </p>
              {cancelScheduleError && (
                <p className="mt-2 text-[13px] text-error" role="alert">
                  {cancelScheduleError}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              loading={cancelingSchedule}
              disabled={cancelingSchedule}
              onClick={() => void handleCancelScheduledChange()}
            >
              Cancel scheduled change
            </Button>
          </div>
        </div>
      )}

      {currentPlan && isPaused && (
        <div className={statusCardClass}>
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {pauseState === 'expired' ? 'Your pause has ended' : 'Your subscription is paused'}
              </h3>
              <p className="text-sm text-text-secondary">
                {pauseState === 'expired'
                  ? 'Continue your plan to restore access, or cancel your subscription.'
                  : pauseEndsAt
                    ? `All your data is safely stored. Paused until ${formatLongDate(pauseEndsAt)}.`
                    : 'All your data is safely stored until you continue your plan.'}
              </p>
              {isCancelScheduled && (
                <p className="mt-2 text-[13px] text-warning">
                  {cancelDateLabel
                    ? `Your subscription is scheduled to cancel on ${cancelDateLabel}.`
                    : 'Your subscription is scheduled to cancel at the end of the billing period.'}
                </p>
              )}
              {resumeError && (
                <p className="mt-2 text-[13px] text-error" role="alert">
                  {resumeError}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              {!isCancelScheduled && (
                <Button variant="outline" onClick={() => router.push('/dashboard/billing/cancel')}>
                  Cancel Subscription
                </Button>
              )}
              <Button
                loading={resuming}
                disabled={resuming}
                onClick={() => void handleResumeSubscription()}
              >
                <Play className="size-4" aria-hidden="true" />
                Continue Plan
              </Button>
            </div>
          </div>
        </div>
      )}

      {currentPlan && !isPaused && isCancelScheduled && (
        <div className={statusCardClass}>
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Your subscription is scheduled to cancel
              </h3>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
                <AlertTriangle size={18} aria-hidden="true" />
                {cancelDateLabel
                  ? `Cancels on ${cancelDateLabel}`
                  : 'Cancels at the end of the billing period'}
              </div>
              <p className="mt-3 text-sm text-text-secondary">
                You keep full access until then. Resume your subscription to keep it renewing
                automatically.
              </p>
              {reactivateError && (
                <p className="mt-2 text-[13px] text-error" role="alert">
                  {reactivateError}
                </p>
              )}
            </div>
            <Button
              loading={reactivating}
              disabled={reactivating}
              onClick={() => void handleReactivateSubscription()}
            >
              <Play className="size-4" aria-hidden="true" />
              Resume subscription
            </Button>
          </div>
        </div>
      )}

      {currentPlan && !isPaused && !isCancelScheduled && (
        <>
          <div className={statusCardClass}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Your {BILLING_PLANS.find((p) => p.key === currentPlan)?.name}
                  {billingCycleLabel ? ` - ${billingCycleLabel}` : ''} subscription renews
                  automatically{cancelDateLabel ? ` on ${cancelDateLabel}` : ''}
                </h3>
                <p className="text-sm text-text-secondary">
                  If you don&apos;t want to renew, you can pause or cancel your subscription.
                </p>
              </div>
            </div>
          </div>

          <div className={statusCardClass}>
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Cancel or Pause Subscription
                </h3>
                <p className="text-sm text-text-secondary">
                  Take a break for up to {MAX_PAUSE_MONTHS} months, or cancel anytime — you can
                  re-activate later at the regular price.
                </p>
              </div>
              <Button variant="outline" onClick={() => router.push('/dashboard/billing/cancel')}>
                Cancel or Pause
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ===== Plan-change confirmation ===== */}
      <Dialog
        open={pendingSwap !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwap(null);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Confirm your plan change</DialogTitle>
            <DialogDescription>
              {pendingSwap?.classification === 'scheduled' && (
                <>
                  Your current {pendingSwap.fromPlanName} plan runs until{' '}
                  {pendingSwap.effectiveAt
                    ? formatLongDate(pendingSwap.effectiveAt)
                    : 'the end of your billing period'}
                  . Your new {pendingSwap.toPlanName} plan starts then — no charge today.
                </>
              )}
              {pendingSwap?.classification === 'immediate_prorate' && (
                <>
                  You&apos;ll be charged the prorated difference
                  {pendingSwap.amountDueCents !== null && pendingSwap.currency
                    ? ` (~${formatCents(pendingSwap.amountDueCents, pendingSwap.currency)})`
                    : ''}{' '}
                  now, and your upgrade to {pendingSwap.toPlanName} takes effect immediately.
                </>
              )}
              {pendingSwap?.classification === 'no_op' && (
                <>You&apos;re already on the {pendingSwap.toPlanName} plan.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingSwap(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const swap = pendingSwap;
                setPendingSwap(null);
                if (swap) void handleSelectPlan(swap.planKey);
              }}
            >
              {pendingSwap?.classification === 'scheduled' ? 'Schedule change' : 'Confirm change'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Enterprise Contact Modal ===== */}
      <Dialog
        open={enterpriseModal.open}
        onOpenChange={(open) => {
          if (!open) setEnterpriseModal((s) => ({ ...s, open: false }));
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
          {enterpriseModal.success ? (
            /* ── Success state ── */
            <div className="text-center">
              <DialogHeader>
                <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
                  <Check className="size-7" aria-hidden="true" />
                </div>
                <DialogTitle className="text-center">Inquiry sent!</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-text-secondary">
                The Theraptly team will reach out to your organization to discuss your needs.
                Redirecting you to the dashboard…
              </p>
            </div>
          ) : (
            /* ── Form state ── */
            <form
              id="enterprise-contact-form"
              onSubmit={(e) => void handleEnterpriseSubmit(e)}
              noValidate
              className="flex flex-col"
            >
              <DialogHeader className="mb-6">
                <DialogTitle>Contact Sales</DialogTitle>
                <p className="text-sm text-text-secondary">
                  Fill out the form to request your free demo.
                </p>
              </DialogHeader>

              {enterpriseModal.error && (
                <Alert variant="error" className="mb-4">
                  {enterpriseModal.error}
                </Alert>
              )}

              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <div className="mb-4">
                  <label htmlFor="ent-first-name" className={labelClass}>
                    First Name <span className={requiredMarkClass}>*</span>
                  </label>
                  <input
                    id="ent-first-name"
                    type="text"
                    autoComplete="given-name"
                    placeholder="Jane"
                    required
                    aria-invalid={!!enterpriseModal.fieldErrors.firstName}
                    aria-describedby={
                      enterpriseModal.fieldErrors.firstName ? 'ent-first-err' : undefined
                    }
                    value={enterpriseModal.firstName}
                    onChange={(e) => setField('firstName', e.target.value)}
                    className={inputClass(!!enterpriseModal.fieldErrors.firstName)}
                  />
                  {enterpriseModal.fieldErrors.firstName && (
                    <span id="ent-first-err" className={fieldErrorTextClass} role="alert">
                      {enterpriseModal.fieldErrors.firstName}
                    </span>
                  )}
                </div>
                <div className="mb-4">
                  <label htmlFor="ent-last-name" className={labelClass}>
                    Last Name <span className={requiredMarkClass}>*</span>
                  </label>
                  <input
                    id="ent-last-name"
                    type="text"
                    autoComplete="family-name"
                    placeholder="Doe"
                    required
                    aria-invalid={!!enterpriseModal.fieldErrors.lastName}
                    aria-describedby={
                      enterpriseModal.fieldErrors.lastName ? 'ent-last-err' : undefined
                    }
                    value={enterpriseModal.lastName}
                    onChange={(e) => setField('lastName', e.target.value)}
                    className={inputClass(!!enterpriseModal.fieldErrors.lastName)}
                  />
                  {enterpriseModal.fieldErrors.lastName && (
                    <span id="ent-last-err" className={fieldErrorTextClass} role="alert">
                      {enterpriseModal.fieldErrors.lastName}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <label htmlFor="ent-email" className={labelClass}>
                  Work Email <span className={requiredMarkClass}>*</span>
                </label>
                <input
                  id="ent-email"
                  type="email"
                  autoComplete="work email"
                  placeholder="jane@organisation.com"
                  required
                  aria-invalid={!!enterpriseModal.fieldErrors.workEmail}
                  aria-describedby={
                    enterpriseModal.fieldErrors.workEmail ? 'ent-email-err' : undefined
                  }
                  value={enterpriseModal.workEmail}
                  onChange={(e) => setField('workEmail', e.target.value)}
                  className={inputClass(!!enterpriseModal.fieldErrors.workEmail)}
                />
                {enterpriseModal.fieldErrors.workEmail && (
                  <span id="ent-email-err" className={fieldErrorTextClass} role="alert">
                    {enterpriseModal.fieldErrors.workEmail}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <div className="mb-4">
                  <label htmlFor="ent-job-title" className={labelClass}>
                    Job Title <span className={requiredMarkClass}>*</span>
                  </label>
                  <input
                    id="ent-job-title"
                    type="text"
                    autoComplete="organization-title"
                    placeholder="Clinical Director"
                    required
                    aria-invalid={!!enterpriseModal.fieldErrors.jobTitle}
                    aria-describedby={
                      enterpriseModal.fieldErrors.jobTitle ? 'ent-job-err' : undefined
                    }
                    value={enterpriseModal.jobTitle}
                    onChange={(e) => setField('jobTitle', e.target.value)}
                    className={inputClass(!!enterpriseModal.fieldErrors.jobTitle)}
                  />
                  {enterpriseModal.fieldErrors.jobTitle && (
                    <span id="ent-job-err" className={fieldErrorTextClass} role="alert">
                      {enterpriseModal.fieldErrors.jobTitle}
                    </span>
                  )}
                </div>
                <div className="mb-4">
                  <label htmlFor="ent-org-name" className={labelClass}>
                    Organization Name <span className={requiredMarkClass}>*</span>
                  </label>
                  <input
                    id="ent-org-name"
                    type="text"
                    autoComplete="organization"
                    placeholder="Sunrise Recovery Center"
                    required
                    aria-invalid={!!enterpriseModal.fieldErrors.organizationName}
                    aria-describedby={
                      enterpriseModal.fieldErrors.organizationName ? 'ent-org-err' : undefined
                    }
                    value={enterpriseModal.organizationName}
                    onChange={(e) => setField('organizationName', e.target.value)}
                    className={inputClass(!!enterpriseModal.fieldErrors.organizationName)}
                  />
                  {enterpriseModal.fieldErrors.organizationName && (
                    <span id="ent-org-err" className={fieldErrorTextClass} role="alert">
                      {enterpriseModal.fieldErrors.organizationName}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <label htmlFor="ent-facility-type" className={labelClass}>
                  Facility Type <span className={requiredMarkClass}>*</span>
                </label>
                <select
                  id="ent-facility-type"
                  required
                  aria-invalid={!!enterpriseModal.fieldErrors.facilityType}
                  aria-describedby={
                    enterpriseModal.fieldErrors.facilityType ? 'ent-fac-type-err' : undefined
                  }
                  value={enterpriseModal.facilityType}
                  onChange={(e) => setField('facilityType', e.target.value)}
                  className={selectClass(!!enterpriseModal.fieldErrors.facilityType)}
                >
                  <option value="">Select facility type…</option>
                  {FACILITY_TYPES.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {enterpriseModal.fieldErrors.facilityType && (
                  <span id="ent-fac-type-err" className={fieldErrorTextClass} role="alert">
                    {enterpriseModal.fieldErrors.facilityType}
                  </span>
                )}
              </div>

              {/* "Other" facility type — shown conditionally */}
              {enterpriseModal.facilityType === 'Other (Custom)' && (
                <div className="mb-4">
                  <label htmlFor="ent-facility-other" className={labelClass}>
                    Please specify <span className={requiredMarkClass}>*</span>
                  </label>
                  <input
                    id="ent-facility-other"
                    type="text"
                    placeholder="Describe your facility type"
                    required
                    aria-invalid={!!enterpriseModal.fieldErrors.facilityTypeOther}
                    aria-describedby={
                      enterpriseModal.fieldErrors.facilityTypeOther
                        ? 'ent-facility-other-err'
                        : undefined
                    }
                    value={enterpriseModal.facilityTypeOther}
                    onChange={(e) => setField('facilityTypeOther', e.target.value)}
                    className={inputClass(!!enterpriseModal.fieldErrors.facilityTypeOther)}
                  />
                  {enterpriseModal.fieldErrors.facilityTypeOther && (
                    <span id="ent-facility-other-err" className={fieldErrorTextClass} role="alert">
                      {enterpriseModal.fieldErrors.facilityTypeOther}
                    </span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <div className="mb-4">
                  <label htmlFor="ent-num-facilities" className={labelClass}>
                    Number of Facilities/Locations <span className={requiredMarkClass}>*</span>
                  </label>
                  <select
                    id="ent-num-facilities"
                    required
                    aria-invalid={!!enterpriseModal.fieldErrors.numberOfFacilities}
                    aria-describedby={
                      enterpriseModal.fieldErrors.numberOfFacilities ? 'ent-fac-err' : undefined
                    }
                    value={enterpriseModal.numberOfFacilities}
                    onChange={(e) => setField('numberOfFacilities', e.target.value)}
                    className={selectClass(!!enterpriseModal.fieldErrors.numberOfFacilities)}
                  >
                    <option value="">Select range…</option>
                    {FACILITY_COUNTS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  {enterpriseModal.fieldErrors.numberOfFacilities && (
                    <span id="ent-fac-err" className={fieldErrorTextClass} role="alert">
                      {enterpriseModal.fieldErrors.numberOfFacilities}
                    </span>
                  )}
                </div>
                <div className="mb-4">
                  <label htmlFor="ent-num-staff" className={labelClass}>
                    Number of Staff <span className={requiredMarkClass}>*</span>
                  </label>
                  <input
                    id="ent-num-staff"
                    type="number"
                    min="1"
                    placeholder="e.g. 150"
                    required
                    aria-invalid={!!enterpriseModal.fieldErrors.numberOfStaff}
                    aria-describedby={
                      enterpriseModal.fieldErrors.numberOfStaff ? 'ent-staff-err' : undefined
                    }
                    value={enterpriseModal.numberOfStaff}
                    onChange={(e) => setField('numberOfStaff', e.target.value)}
                    className={inputClass(!!enterpriseModal.fieldErrors.numberOfStaff)}
                  />
                  {enterpriseModal.fieldErrors.numberOfStaff && (
                    <span id="ent-staff-err" className={fieldErrorTextClass} role="alert">
                      {enterpriseModal.fieldErrors.numberOfStaff}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <label htmlFor="ent-accreditation" className={labelClass}>
                  Current Accreditation <span className={requiredMarkClass}>*</span>
                </label>
                <select
                  id="ent-accreditation"
                  required
                  aria-invalid={!!enterpriseModal.fieldErrors.currentAccreditation}
                  aria-describedby={
                    enterpriseModal.fieldErrors.currentAccreditation ? 'ent-acc-err' : undefined
                  }
                  value={enterpriseModal.currentAccreditation}
                  onChange={(e) => setField('currentAccreditation', e.target.value)}
                  className={selectClass(!!enterpriseModal.fieldErrors.currentAccreditation)}
                >
                  <option value="">Select accreditation…</option>
                  {ACCREDITATION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {enterpriseModal.fieldErrors.currentAccreditation && (
                  <span id="ent-acc-err" className={fieldErrorTextClass} role="alert">
                    {enterpriseModal.fieldErrors.currentAccreditation}
                  </span>
                )}
              </div>

              <div className="mb-4">
                <label htmlFor="ent-training-method" className={labelClass}>
                  Current Training Method <span className={requiredMarkClass}>*</span>
                </label>
                <select
                  id="ent-training-method"
                  required
                  aria-invalid={!!enterpriseModal.fieldErrors.currentTrainingMethod}
                  aria-describedby={
                    enterpriseModal.fieldErrors.currentTrainingMethod ? 'ent-method-err' : undefined
                  }
                  value={enterpriseModal.currentTrainingMethod}
                  onChange={(e) => setField('currentTrainingMethod', e.target.value)}
                  className={selectClass(!!enterpriseModal.fieldErrors.currentTrainingMethod)}
                >
                  <option value="">Select training method…</option>
                  {TRAINING_METHODS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {enterpriseModal.fieldErrors.currentTrainingMethod && (
                  <span id="ent-method-err" className={fieldErrorTextClass} role="alert">
                    {enterpriseModal.fieldErrors.currentTrainingMethod}
                  </span>
                )}
              </div>

              <div className="mb-4">
                <label htmlFor="ent-pain-point" className={labelClass}>
                  Primary Pain Point <span className={requiredMarkClass}>*</span>
                </label>
                <textarea
                  id="ent-pain-point"
                  required
                  aria-invalid={!!enterpriseModal.fieldErrors.primaryPainPoint}
                  aria-describedby={
                    enterpriseModal.fieldErrors.primaryPainPoint ? 'ent-pain-err' : undefined
                  }
                  rows={3}
                  placeholder="e.g. Our trainings are out of date and hard to track…"
                  value={enterpriseModal.primaryPainPoint}
                  onChange={(e) => setField('primaryPainPoint', e.target.value)}
                  className={cn(
                    inputClass(!!enterpriseModal.fieldErrors.primaryPainPoint),
                    'resize-y',
                  )}
                />
                {enterpriseModal.fieldErrors.primaryPainPoint && (
                  <span id="ent-pain-err" className={fieldErrorTextClass} role="alert">
                    {enterpriseModal.fieldErrors.primaryPainPoint}
                  </span>
                )}
              </div>

              <p className="mb-6 mt-3 text-xs leading-relaxed text-text-secondary">
                By clicking &quot;Request a demo&quot;, you agree to Theraptly&apos;s{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Terms & Conditions
                </a>{' '}
                and{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Privacy Policy
                </a>
                .
              </p>

              <HCaptcha
                onVerify={setEnterpriseCaptchaToken}
                onExpire={() => setEnterpriseCaptchaToken(undefined)}
              />

              <div className="flex flex-col gap-2.5">
                <Button
                  type="submit"
                  className="w-full"
                  loading={enterpriseModal.loading}
                  disabled={enterpriseModal.loading}
                >
                  {enterpriseModal.loading ? 'Sending…' : 'Request a demo'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setEnterpriseModal((s) => ({ ...s, open: false }))}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
