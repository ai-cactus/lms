'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import styles from './billing.module.css';
import {
  BILLING_PLANS,
  BillingCycle,
  CYCLE_DISCOUNTS,
  getEffectiveMonthlyPrice,
  canSelectPlan,
} from '@/lib/billing-plans';

type Tab = 'overview' | 'billing-history' | 'subscription' | 'payment-method';

interface Props {
  orgStaffCount: number;
  currentPlan: string | null;
  onChangeTab: (tab: Tab) => void;
}

// ── Dropdown option sets ─────────────────────────────────────────────────────

const FACILITY_TYPES = [
  'Behavioural Health Center',
  'Substance Use Disorder (SUD) Treatment',
  'Post-Acute Care',
  'Intellectual/Developmental Disabilities (IDD)',
  'Other (Custom)',
] as const;

const FACILITY_COUNTS = ['1-5', '6-20', '21+'] as const;

const ACCREDITATION_OPTIONS = [
  'The Joint Commission (TJC)',
  'CARF International',
  'COA (Council on Accreditation)',
  'State-Level Licensing only',
] as const;

const TRAINING_METHODS = ['Self-directed', 'Consultant-led', 'Legacy Software'] as const;

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

interface CancelModalState {
  open: boolean;
  loading: boolean;
  error: string | null;
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

export default function SubscriptionTab({ orgStaffCount, currentPlan, onChangeTab }: Props) {
  const router = useRouter();
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

  const [cancelModal, setCancelModal] = useState<CancelModalState>({
    open: false,
    loading: false,
    error: null,
  });

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
          window.location.href = data.url;
        }
      } catch (err) {
        setCheckoutError(err instanceof Error ? err.message : 'Unexpected error');
      } finally {
        setCheckoutLoading(null);
      }
    },
    [checkoutLoading, cycle],
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

  // ── Cancel subscription ────────────────────────────────────────────────────

  const handleCancelSubscription = useCallback(async () => {
    setCancelModal((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch('/api/billing/subscription/cancel', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to cancel subscription');
      setCancelModal({ open: false, loading: false, error: null });
      onChangeTab('overview');
    } catch (err) {
      setCancelModal((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Unexpected error',
      }));
    }
  }, [onChangeTab]);

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
      <div className={styles.plansHeader}>
        <h2>Change plans</h2>
        <p>Select the best plan for your team size and budget. Upgrade or downgrade at any time.</p>
      </div>

      {checkoutError && <div className={styles.errorBanner}>{checkoutError}</div>}

      {/* Billing cycle toggle */}
      <div className={styles.cycleToggle} role="group" aria-label="Billing cycle">
        {cycles.map((c) => (
          <button
            key={c}
            className={`${styles.cycleBtn} ${cycle === c ? styles.cycleBtnActive : ''}`}
            onClick={() => setCycle(c)}
          >
            {cycleLabels[c]}
          </button>
        ))}
      </div>

      {/* Plan cards */}
      <div className={styles.plansGrid}>
        {BILLING_PLANS.map((plan) => {
          const allowed = canSelectPlan(plan, orgStaffCount);
          const effectivePrice = getEffectiveMonthlyPrice(plan, cycle);
          const discount = CYCLE_DISCOUNTS[cycle];

          return (
            <div
              key={plan.key}
              className={[
                styles.planCard,
                !allowed && !plan.isEnterprise ? styles.planCardDisabled : '',
              ].join(' ')}
              aria-disabled={!allowed && !plan.isEnterprise}
            >
              {currentPlan && plan.key === currentPlan && (
                <div className={styles.currentPlanBadge}>CURRENT PLAN</div>
              )}

              <p className={styles.planCardName}>{plan.name}</p>
              <p className={styles.planCardDesc}>{plan.description}</p>

              <div className={styles.planCardPrice}>
                {plan.isEnterprise ? (
                  <span className={styles.priceCustom}>Custom</span>
                ) : (
                  <>
                    <span className={styles.priceAmount}>${effectivePrice}</span>
                    <span className={styles.priceUnit}>
                      /mo{discount > 0 ? ` (billed ${cycle})` : ''}
                    </span>
                  </>
                )}
              </div>

              {plan.isEnterprise ? (
                <button
                  id={`plan-btn-${plan.key}`}
                  className={`${styles.planCardBtn} ${styles.planCardBtnPrimary}`}
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
                  className={`${styles.planCardBtn} ${styles.planCardBtnSecondary}`}
                  disabled={!allowed || checkoutLoading === plan.key}
                  onClick={() => void handleSelectPlan(plan.key)}
                >
                  {checkoutLoading === plan.key ? 'Redirecting...' : 'Choose plan'}
                </button>
              )}

              <p className={styles.featuresLabel}>{plan.featuresLabel}</p>
              <ul className={styles.featureList}>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <svg
                      className={styles.featureCheckIcon}
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Cancel subscription link */}
      <button
        className={styles.cancelLink}
        onClick={() => setCancelModal({ open: true, loading: false, error: null })}
      >
        ⊗ Cancel subscription
      </button>

      {/* ===== Enterprise Contact Modal ===== */}
      {enterpriseModal.open && (
        <div
          className={styles.modalBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEnterpriseModal((s) => ({ ...s, open: false }));
          }}
        >
          <div
            className={`${styles.modal} ${styles.modalWide}`}
            role="dialog"
            aria-modal="true"
            aria-label="Enterprise plan inquiry"
          >
            {enterpriseModal.success ? (
              /* ── Success state ── */
              <>
                <div className={`${styles.modalIcon} ${styles.modalIconSuccess}`}>
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2>Inquiry sent!</h2>
                <p>
                  The Theraptly team will reach out to your organization to discuss your needs.
                  Redirecting you to the dashboard…
                </p>
              </>
            ) : (
              /* ── Form state ── */
              <form
                id="enterprise-contact-form"
                onSubmit={(e) => void handleEnterpriseSubmit(e)}
                noValidate
              >
                {/* Header */}
                <div className={styles.enterpriseModalHeader}>
                  <h2>Contact Sales</h2>
                  <p>Fill out the form to request your free demo.</p>
                </div>

                {enterpriseModal.error && (
                  <div className={styles.errorBanner} role="alert">
                    {enterpriseModal.error}
                  </div>
                )}

                {/* Row: First Name + Last Name */}
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label htmlFor="ent-first-name">
                      First Name <span className={styles.requiredMark}>*</span>
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
                      className={enterpriseModal.fieldErrors.firstName ? styles.inputError : ''}
                    />
                    {enterpriseModal.fieldErrors.firstName && (
                      <span id="ent-first-err" className={styles.fieldError} role="alert">
                        {enterpriseModal.fieldErrors.firstName}
                      </span>
                    )}
                  </div>
                  <div className={styles.formGroup}>
                    <label htmlFor="ent-last-name">
                      Last Name <span className={styles.requiredMark}>*</span>
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
                      className={enterpriseModal.fieldErrors.lastName ? styles.inputError : ''}
                    />
                    {enterpriseModal.fieldErrors.lastName && (
                      <span id="ent-last-err" className={styles.fieldError} role="alert">
                        {enterpriseModal.fieldErrors.lastName}
                      </span>
                    )}
                  </div>
                </div>

                {/* Work Email */}
                <div className={styles.formGroup}>
                  <label htmlFor="ent-email">
                    Work Email <span className={styles.requiredMark}>*</span>
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
                    className={enterpriseModal.fieldErrors.workEmail ? styles.inputError : ''}
                  />
                  {enterpriseModal.fieldErrors.workEmail && (
                    <span id="ent-email-err" className={styles.fieldError} role="alert">
                      {enterpriseModal.fieldErrors.workEmail}
                    </span>
                  )}
                </div>

                {/* Row: Job Title + Organization Name */}
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label htmlFor="ent-job-title">
                      Job Title <span className={styles.requiredMark}>*</span>
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
                      className={enterpriseModal.fieldErrors.jobTitle ? styles.inputError : ''}
                    />
                    {enterpriseModal.fieldErrors.jobTitle && (
                      <span id="ent-job-err" className={styles.fieldError} role="alert">
                        {enterpriseModal.fieldErrors.jobTitle}
                      </span>
                    )}
                  </div>
                  <div className={styles.formGroup}>
                    <label htmlFor="ent-org-name">
                      Organization Name <span className={styles.requiredMark}>*</span>
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
                      className={
                        enterpriseModal.fieldErrors.organizationName ? styles.inputError : ''
                      }
                    />
                    {enterpriseModal.fieldErrors.organizationName && (
                      <span id="ent-org-err" className={styles.fieldError} role="alert">
                        {enterpriseModal.fieldErrors.organizationName}
                      </span>
                    )}
                  </div>
                </div>

                {/* Facility Type */}
                <div className={styles.formGroup}>
                  <label htmlFor="ent-facility-type">
                    Facility Type <span className={styles.requiredMark}>*</span>
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
                    className={`${styles.selectField} ${
                      enterpriseModal.fieldErrors.facilityType ? styles.inputError : ''
                    }`}
                  >
                    <option value="">Select facility type…</option>
                    {FACILITY_TYPES.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  {enterpriseModal.fieldErrors.facilityType && (
                    <span id="ent-fac-type-err" className={styles.fieldError} role="alert">
                      {enterpriseModal.fieldErrors.facilityType}
                    </span>
                  )}
                </div>

                {/* "Other" facility type — shown conditionally */}
                {enterpriseModal.facilityType === 'Other (Custom)' && (
                  <div className={styles.formGroup}>
                    <label htmlFor="ent-facility-other">
                      Please specify <span className={styles.requiredMark}>*</span>
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
                      className={
                        enterpriseModal.fieldErrors.facilityTypeOther ? styles.inputError : ''
                      }
                    />
                    {enterpriseModal.fieldErrors.facilityTypeOther && (
                      <span id="ent-facility-other-err" className={styles.fieldError} role="alert">
                        {enterpriseModal.fieldErrors.facilityTypeOther}
                      </span>
                    )}
                  </div>
                )}

                {/* Row: Number of Facilities + Number of Staff */}
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label htmlFor="ent-num-facilities">
                      Number of Facilities/Locations <span className={styles.requiredMark}>*</span>
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
                      className={`${styles.selectField} ${
                        enterpriseModal.fieldErrors.numberOfFacilities ? styles.inputError : ''
                      }`}
                    >
                      <option value="">Select range…</option>
                      {FACILITY_COUNTS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {enterpriseModal.fieldErrors.numberOfFacilities && (
                      <span id="ent-fac-err" className={styles.fieldError} role="alert">
                        {enterpriseModal.fieldErrors.numberOfFacilities}
                      </span>
                    )}
                  </div>
                  <div className={styles.formGroup}>
                    <label htmlFor="ent-num-staff">
                      Number of Staff <span className={styles.requiredMark}>*</span>
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
                      className={enterpriseModal.fieldErrors.numberOfStaff ? styles.inputError : ''}
                    />
                    {enterpriseModal.fieldErrors.numberOfStaff && (
                      <span id="ent-staff-err" className={styles.fieldError} role="alert">
                        {enterpriseModal.fieldErrors.numberOfStaff}
                      </span>
                    )}
                  </div>
                </div>

                {/* Current Accreditation */}
                <div className={styles.formGroup}>
                  <label htmlFor="ent-accreditation">
                    Current Accreditation <span className={styles.requiredMark}>*</span>
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
                    className={`${styles.selectField} ${
                      enterpriseModal.fieldErrors.currentAccreditation ? styles.inputError : ''
                    }`}
                  >
                    <option value="">Select accreditation…</option>
                    {ACCREDITATION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  {enterpriseModal.fieldErrors.currentAccreditation && (
                    <span id="ent-acc-err" className={styles.fieldError} role="alert">
                      {enterpriseModal.fieldErrors.currentAccreditation}
                    </span>
                  )}
                </div>

                {/* Current Training Method */}
                <div className={styles.formGroup}>
                  <label htmlFor="ent-training-method">
                    Current Training Method <span className={styles.requiredMark}>*</span>
                  </label>
                  <select
                    id="ent-training-method"
                    required
                    aria-invalid={!!enterpriseModal.fieldErrors.currentTrainingMethod}
                    aria-describedby={
                      enterpriseModal.fieldErrors.currentTrainingMethod
                        ? 'ent-method-err'
                        : undefined
                    }
                    value={enterpriseModal.currentTrainingMethod}
                    onChange={(e) => setField('currentTrainingMethod', e.target.value)}
                    className={`${styles.selectField} ${
                      enterpriseModal.fieldErrors.currentTrainingMethod ? styles.inputError : ''
                    }`}
                  >
                    <option value="">Select training method…</option>
                    {TRAINING_METHODS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  {enterpriseModal.fieldErrors.currentTrainingMethod && (
                    <span id="ent-method-err" className={styles.fieldError} role="alert">
                      {enterpriseModal.fieldErrors.currentTrainingMethod}
                    </span>
                  )}
                </div>

                {/* Primary Pain Point */}
                <div className={styles.formGroup}>
                  <label htmlFor="ent-pain-point">
                    Primary Pain Point <span className={styles.requiredMark}>*</span>
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
                    className={
                      enterpriseModal.fieldErrors.primaryPainPoint ? styles.inputError : ''
                    }
                  />
                  {enterpriseModal.fieldErrors.primaryPainPoint && (
                    <span id="ent-pain-err" className={styles.fieldError} role="alert">
                      {enterpriseModal.fieldErrors.primaryPainPoint}
                    </span>
                  )}
                </div>

                {/* Terms and Conditions Disclaimer */}
                <p className={styles.termsText}>
                  By clicking &quot;Request a demo&quot;, you agree to Theraptly&apos;s{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer">
                    Terms & Conditions
                  </a>{' '}
                  and{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </a>
                  .
                </p>

                {/* Actions */}
                <div className={styles.modalActions}>
                  <button
                    type="submit"
                    className={styles.btnPrimary}
                    disabled={enterpriseModal.loading}
                  >
                    {enterpriseModal.loading ? 'Sending…' : 'Request a demo'}
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setEnterpriseModal((s) => ({ ...s, open: false }))}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ===== Cancel Subscription Confirmation Modal ===== */}
      {cancelModal.open && (
        <div
          className={styles.modalBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCancelModal((s) => ({ ...s, open: false }));
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Cancel subscription confirmation"
          >
            <div className={`${styles.modalIcon} ${styles.modalIconWarning}`}>
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h2>Cancel subscription?</h2>
            <p>
              Your plan will remain active until the end of the current billing period. After that,
              your account will lose access to premium features.
            </p>

            {cancelModal.error && (
              <div className={styles.errorBanner} role="alert">
                {cancelModal.error}
              </div>
            )}

            <div className={styles.modalActions}>
              <button
                className={styles.btnDanger}
                disabled={cancelModal.loading}
                onClick={() => void handleCancelSubscription()}
              >
                {cancelModal.loading ? 'Canceling...' : 'Yes, cancel subscription'}
              </button>
              <button
                className={styles.btnSecondary}
                onClick={() => setCancelModal({ open: false, loading: false, error: null })}
              >
                Keep my plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
