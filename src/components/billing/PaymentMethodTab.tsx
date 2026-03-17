'use client';

import React, { useEffect, useState, useCallback } from 'react';
import styles from './billing.module.css';

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  billingDetails: {
    name: string | null;
    email: string | null;
    address: {
      line1: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
      postal_code: string | null;
    } | null;
  };
  isDefault: boolean;
}

type ModalState =
  | { type: 'none' }
  | { type: 'confirm-delete'; pm: PaymentMethod }
  | { type: 'delete-success'; pmLabel: string };

export default function PaymentMethodTab() {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const fetchPaymentMethods = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/billing/payment-methods');
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to load payment methods');
      }
      const json = await res.json();
      setPaymentMethods(json.paymentMethods);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  const handleDelete = useCallback(async (pm: PaymentMethod) => {
    setActionLoading(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/billing/payment-methods/${pm.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to remove payment method');

      const pmLabel = `${pm.brand.toUpperCase()} •••• ${pm.last4}`;
      setPaymentMethods((prev) => prev.filter((p) => p.id !== pm.id));
      setModal({ type: 'delete-success', pmLabel });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setActionLoading(false);
    }
  }, []);

  const handleSetDefault = useCallback(async (pmId: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/billing/payment-methods/${pmId}/default`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to set default');

      // Update local state optimistically
      setPaymentMethods((prev) => prev.map((p) => ({ ...p, isDefault: p.id === pmId })));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setActionLoading(false);
    }
  }, []);

  // Opens the Stripe Billing Portal so the user can add or manage payment methods
  const handleOpenPortal = useCallback(async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to open billing portal');
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setPortalLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.spinner} />
        <span>Loading payment methods...</span>
      </div>
    );
  }

  if (error) return <div className={styles.errorBanner}>{error}</div>;

  const primaryMethod = paymentMethods.find((p) => p.isDefault);
  const otherMethods = paymentMethods.filter((p) => !p.isDefault);

  return (
    <div>
      <div className={styles.pmHeader}>
        <div>
          <h2>Payment Method</h2>
          <p>
            Manage your subscription plans, update payment methods, and download your previous
            invoices.
          </p>
        </div>
        <button
          id="add-payment-method-btn"
          className={styles.addBtn}
          disabled={portalLoading}
          onClick={() => void handleOpenPortal()}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {portalLoading ? 'Opening portal...' : 'Add Payment Method'}
        </button>
      </div>

      {(actionError || portalError) && (
        <div className={styles.errorBanner}>{actionError ?? portalError}</div>
      )}

      {/* Primary Method */}
      {primaryMethod && (
        <>
          <p className={styles.pmSectionTitle}>Primary Method</p>
          <div className={styles.pmList}>
            <PaymentMethodCard
              pm={primaryMethod}
              onRemove={() => setModal({ type: 'confirm-delete', pm: primaryMethod })}
              onSetDefault={() => void handleSetDefault(primaryMethod.id)}
              actionLoading={actionLoading}
            />
          </div>
        </>
      )}

      {/* Other Methods */}
      {otherMethods.length > 0 && (
        <>
          <p className={styles.pmSectionTitle}>Other Methods</p>
          <div className={styles.pmList}>
            {otherMethods.map((pm) => (
              <PaymentMethodCard
                key={pm.id}
                pm={pm}
                onRemove={() => setModal({ type: 'confirm-delete', pm })}
                onSetDefault={() => void handleSetDefault(pm.id)}
                actionLoading={actionLoading}
              />
            ))}
          </div>
        </>
      )}

      {paymentMethods.length === 0 && (
        <div className={styles.emptyState}>
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="1.5"
          >
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          <p>No payment methods on file.</p>
        </div>
      )}

      {/* ===== Remove Confirmation Modal ===== */}
      {modal.type === 'confirm-delete' && (
        <div
          className={styles.modalBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal({ type: 'none' });
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Remove payment method"
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
            <h2>Remove payment method?</h2>
            <p>
              Are you sure you want to remove{' '}
              <strong>
                {modal.pm.brand.toUpperCase()} •••• {modal.pm.last4}
              </strong>{' '}
              from your account? You will no longer be charged using this method.
            </p>

            {actionError && <div className={styles.errorBanner}>{actionError}</div>}

            <div className={styles.modalActions}>
              <button
                className={styles.btnDanger}
                disabled={actionLoading}
                onClick={() => void handleDelete(modal.pm)}
              >
                {actionLoading ? 'Removing...' : 'Remove Payment Method'}
              </button>
              <button
                className={styles.btnSecondary}
                onClick={() => {
                  setModal({ type: 'none' });
                  setActionError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Success Modal ===== */}
      {modal.type === 'delete-success' && (
        <div
          className={styles.modalBackdrop}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal({ type: 'none' });
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Payment method removed"
          >
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
            <h2>Payment method removed</h2>
            <p>
              The card <strong>({modal.pmLabel})</strong> has been successfully removed from your
              account. You will no longer be charged using this method.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.btnPrimary} onClick={() => setModal({ type: 'none' })}>
                Return to Billing
              </button>
              <button className={styles.btnSecondary} onClick={() => setModal({ type: 'none' })}>
                Back to Payment Methods
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component ──────────────────────────────────────────────────────────

interface PaymentMethodCardProps {
  pm: PaymentMethod;
  onRemove: () => void;
  onSetDefault: () => void;
  actionLoading: boolean;
}

function PaymentMethodCard({ pm, onRemove, onSetDefault, actionLoading }: PaymentMethodCardProps) {
  const brandLabel = pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1);

  return (
    <div className={styles.pmCard}>
      <div className={styles.pmCardBrand}>{pm.brand.slice(0, 4)}</div>
      <div className={styles.pmCardInfo}>
        <p>
          {brandLabel} •••• {pm.last4}
          {pm.isDefault && (
            <span className={styles.pmDefaultBadge} style={{ marginLeft: 8 }}>
              Default
            </span>
          )}
        </p>
        <span>
          Expires {String(pm.expMonth).padStart(2, '0')}/{pm.expYear}
        </span>
      </div>
      <div className={styles.pmCardActions}>
        {!pm.isDefault && (
          <button
            className={styles.pmSetDefaultBtn}
            disabled={actionLoading}
            onClick={onSetDefault}
          >
            Set as Default
          </button>
        )}
        <button
          className={`${styles.pmActionBtn} ${styles.pmRemoveBtn}`}
          disabled={actionLoading}
          onClick={onRemove}
          aria-label={`Remove ${brandLabel} ending in ${pm.last4}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
