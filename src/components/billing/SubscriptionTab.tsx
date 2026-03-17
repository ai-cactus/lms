'use client';

import React, { useState, useCallback } from 'react';
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
  /** Current org staff count as integer */
  orgStaffCount: number;
  onChangeTab: (tab: Tab) => void;
}

interface EnterpriseModalState {
  open: boolean;
  contactName: string;
  message: string;
  loading: boolean;
  success: boolean;
  error: string | null;
}

interface CancelModalState {
  open: boolean;
  loading: boolean;
  error: string | null;
}

export default function SubscriptionTab({ orgStaffCount, onChangeTab }: Props) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [enterpriseModal, setEnterpriseModal] = useState<EnterpriseModalState>({
    open: false,
    contactName: '',
    message: '',
    loading: false,
    success: false,
    error: null,
  });

  const [cancelModal, setCancelModal] = useState<CancelModalState>({
    open: false,
    loading: false,
    error: null,
  });

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

        // Redirect to Stripe Checkout
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

  const handleEnterpriseSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setEnterpriseModal((s) => ({ ...s, loading: true, error: null }));

      try {
        const res = await fetch('/api/billing/contact-enterprise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactName: enterpriseModal.contactName,
            message: enterpriseModal.message,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? 'Failed to send inquiry');
        }

        setEnterpriseModal((s) => ({ ...s, loading: false, success: true }));
      } catch (err) {
        setEnterpriseModal((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Unexpected error',
        }));
      }
    },
    [enterpriseModal.contactName, enterpriseModal.message],
  );

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

  const cycles: BillingCycle[] = ['monthly', 'quarterly', 'yearly'];
  const cycleLabels: Record<BillingCycle, string> = {
    monthly: 'Monthly',
    quarterly: 'Quarterly (-10%)',
    yearly: 'Yearly (-25%)',
  };

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
              {/* "Current Plan" badge — placeholder; real check would come from subscription data */}
              {plan.key === 'professional' && (
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
                      open: true,
                      success: false,
                      error: null,
                      contactName: '',
                      message: '',
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
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Enterprise plan inquiry"
          >
            {enterpriseModal.success ? (
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
                <p>The Theraptly team will reach out to your organization to discuss your needs.</p>
                <div className={styles.modalActions}>
                  <button
                    className={styles.btnPrimary}
                    onClick={() => setEnterpriseModal((s) => ({ ...s, open: false }))}
                  >
                    Return to Billing
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={(e) => void handleEnterpriseSubmit(e)}>
                <h2 style={{ marginBottom: 8 }}>Contact Sales</h2>
                <p>Tell us about your organization and we will be in touch.</p>

                {enterpriseModal.error && (
                  <div className={styles.errorBanner}>{enterpriseModal.error}</div>
                )}

                <div className={styles.formGroup}>
                  <label htmlFor="enterprise-name">Your name</label>
                  <input
                    id="enterprise-name"
                    type="text"
                    required
                    value={enterpriseModal.contactName}
                    onChange={(e) =>
                      setEnterpriseModal((s) => ({ ...s, contactName: e.target.value }))
                    }
                    placeholder="Jane Doe"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="enterprise-message">Tell us about your needs</label>
                  <textarea
                    id="enterprise-message"
                    required
                    rows={4}
                    value={enterpriseModal.message}
                    onChange={(e) => setEnterpriseModal((s) => ({ ...s, message: e.target.value }))}
                    placeholder="We have 150+ staff across 3 locations..."
                  />
                </div>

                <div className={styles.modalActions}>
                  <button
                    type="submit"
                    className={styles.btnPrimary}
                    disabled={enterpriseModal.loading}
                  >
                    {enterpriseModal.loading ? 'Sending...' : 'Send inquiry'}
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

            {cancelModal.error && <div className={styles.errorBanner}>{cancelModal.error}</div>}

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
