'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  BILLING_PLANS,
  BillingCycle,
  CYCLE_DISCOUNTS,
  getEffectiveMonthlyPrice,
  canSelectPlan,
} from '@/lib/billing-plans';
import { Star, Check, Play } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { MAX_PAUSE_MONTHS, getPauseState } from '@/lib/billing';

type Tab = 'overview' | 'billing-history' | 'subscription' | 'payment-method';

interface Props {
  orgStaffCount: number;
  currentPlan: string | null;
  pausedAt?: string | null;
  pauseEndsAt?: string | null;
  onChangeTab: (tab: Tab) => void;
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
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
  pausedAt = null,
  pauseEndsAt = null,
  onChangeTab,
}: Props) {
  const router = useRouter();
  const pauseState = getPauseState({ status: null, pausedAt, pauseEndsAt });
  const isPaused = pauseState !== 'none';
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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

        // Existing subscription was swapped in place (THER-001) — no redirect.
        // Refresh so the new plan is reflected and send the admin to Overview.
        if (data.updated) {
          router.refresh();
          onChangeTab('overview');
        }
      } catch (err) {
        setCheckoutError(err instanceof Error ? err.message : 'Unexpected error');
      } finally {
        setCheckoutLoading(null);
      }
    },
    [checkoutLoading, cycle, router, onChangeTab],
  );

  // ── Enterprise form field helper ───────────────────────────────────────────

  const setField = useCallback(
    <K extends keyof EnterpriseFormFields>(key: K, value: EnterpriseFormFields[K]) => {
      setEnterpriseModal((s) => ({
        ...s,
        [key]: value,
        // Clear field error on change
        fieldErrors: { ...s.fieldErrors, [key]: undefined },
      }));
    },
    [],
  );

  // ── Enterprise submit ──────────────────────────────────────────────────────

  const handleEnterpriseSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      // Client-side validation
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
    [enterpriseModal, router],
  );

  // ── Resume subscription (Continue Plan) ────────────────────────────────────

  const handleResumeSubscription = useCallback(async () => {
    setResuming(true);
    setResumeError(null);
    try {
      const res = await fetch('/api/billing/subscription/resume', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to resume subscription');
      router.refresh();
      onChangeTab('overview');
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setResuming(false);
    }
  }, [onChangeTab, router]);

  // ── Billing cycle labels ───────────────────────────────────────────────────

  const cycles: BillingCycle[] = ['monthly', 'quarterly', 'yearly'];
  const cycleLabels: Record<BillingCycle, string> = {
    monthly: 'Monthly',
    quarterly: 'Quarterly (-10%)',
    yearly: 'Yearly (-25%)',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="mb-7">
        <h2 className="mb-1.5 text-[26px] font-bold text-foreground">Select a plan</h2>
        <p className="text-sm text-text-secondary">
          Select the best plan for your team size and budget — Upgrade or cancel at anytime.
        </p>
      </div>

      {checkoutError && (
        <div className="mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-[13px] text-error">
          {checkoutError}
        </div>
      )}

      {/* Billing cycle toggle */}
      <div
        className="mb-8 inline-flex max-w-full gap-0 overflow-x-auto rounded-lg bg-muted p-1"
        role="group"
        aria-label="Billing cycle"
      >
        {cycles.map((c) => (
          <button
            key={c}
            className={cn(
              'cursor-pointer whitespace-nowrap rounded-md px-5 py-2 text-[13px] font-medium transition-colors',
              cycle === c ? 'bg-background text-primary shadow-sm' : 'text-text-secondary',
            )}
            onClick={() => setCycle(c)}
          >
            {cycleLabels[c]}
          </button>
        ))}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(270px,1fr))]">
        {BILLING_PLANS.map((plan) => {
          const allowed = canSelectPlan(plan, orgStaffCount);
          const effectivePrice = getEffectiveMonthlyPrice(plan, cycle);
          const discount = CYCLE_DISCOUNTS[cycle];
          const isCurrent = currentPlan === plan.key;
          const isDisabled = !allowed && !plan.isEnterprise;

          return (
            <div
              key={plan.key}
              className={cn(
                'relative flex flex-col rounded-xl border-[1.5px] border-border bg-background p-7 transition-all',
                isCurrent && 'border-primary bg-primary/5 shadow-[0_4px_16px_rgba(51,92,255,0.12)]',
                !isCurrent &&
                  !isDisabled &&
                  'hover:border-primary hover:shadow-[0_4px_16px_rgba(51,92,255,0.1)]',
                isDisabled && 'pointer-events-none cursor-not-allowed opacity-50',
              )}
              aria-disabled={isDisabled}
            >
              {plan.key === 'professional' && (
                <div className="absolute right-6 top-6 flex items-center gap-1 rounded-full border border-primary bg-background px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.6px] text-primary">
                  <Star size={12} fill="currentColor" /> POPULAR
                </div>
              )}

              <p className="mb-1 text-lg font-bold text-foreground">{plan.name}</p>
              <p className="mb-5 text-[13px] text-text-secondary">{plan.description}</p>

              <div className="mb-5 flex items-baseline gap-1">
                {plan.isEnterprise ? (
                  <span className="text-[32px] font-extrabold text-foreground">Custom</span>
                ) : (
                  <>
                    <span className="text-[38px] font-extrabold text-foreground">
                      ${effectivePrice}
                    </span>
                    <span className="text-sm text-text-secondary">
                      /mo{discount > 0 ? ` (billed ${cycle})` : ''}
                    </span>
                  </>
                )}
              </div>

              {plan.isEnterprise ? (
                <button
                  id={`plan-btn-${plan.key}`}
                  className="mb-6 w-full cursor-pointer rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
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
                <>
                  <button
                    id={`plan-btn-${plan.key}`}
                    className={cn(
                      'mb-6 w-full rounded-lg px-3 py-3 text-sm font-semibold transition-colors',
                      isCurrent
                        ? 'cursor-default bg-[#cbd5e1] text-white'
                        : 'cursor-pointer border-[1.5px] border-primary bg-background text-primary hover:bg-primary/10',
                    )}
                    disabled={isCurrent || !allowed || checkoutLoading === plan.key}
                    onClick={() => void handleSelectPlan(plan.key)}
                  >
                    {checkoutLoading === plan.key
                      ? 'Redirecting...'
                      : isCurrent
                        ? 'Current Plan'
                        : 'Subscribe'}
                  </button>
                </>
              )}

              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.8px] text-text-tertiary">
                {plan.featuresLabel}
              </p>
              <ul className="flex flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-2.5 text-[13px] text-foreground"
                  >
                    <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {currentPlan && isPaused && (
        <div className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-background p-6">
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
              {resumeError && (
                <p className="mt-2 text-[13px] text-error" role="alert">
                  {resumeError}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => router.push('/dashboard/billing/cancel')}>
                Cancel Subscription
              </Button>
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

      {currentPlan && !isPaused && (
        <>
          <div className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-background p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Your {BILLING_PLANS.find((p) => p.key === currentPlan)?.name} -{' '}
                  {cycle.charAt(0).toUpperCase() + cycle.slice(1)} subscription renews
                  automatically...
                </h3>
                <p className="text-sm text-text-secondary">
                  If you don&apos;t want to renew, you can pause or cancel your subscription.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-background p-6">
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
              {/* Header */}
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

              {/* Row: First Name + Last Name */}
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

              {/* Work Email */}
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

              {/* Row: Job Title + Organization Name */}
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

              {/* Facility Type */}
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

              {/* Row: Number of Facilities + Number of Staff */}
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

              {/* Current Accreditation */}
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

              {/* Current Training Method */}
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

              {/* Primary Pain Point */}
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

              {/* Terms and Conditions Disclaimer */}
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

              {/* Actions */}
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
