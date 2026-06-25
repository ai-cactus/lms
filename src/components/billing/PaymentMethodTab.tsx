'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Loader2, AlertTriangle, Check, CreditCard } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

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
      const res = await fetch('/api/billing/payment-methods', { cache: 'no-store' });
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
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-sm text-text-tertiary">
        <Loader2 className="size-7 animate-spin text-primary" aria-hidden="true" />
        <span>Loading payment methods...</span>
      </div>
    );
  }

  if (error)
    return (
      <div className="mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-[13px] text-error">
        {error}
      </div>
    );

  const primaryMethod = paymentMethods.find((p) => p.isDefault);
  const otherMethods = paymentMethods.filter((p) => !p.isDefault);

  return (
    <div>
      <div className="mb-6 flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h2 className="text-[22px] font-bold text-foreground">Payment Method</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Manage your subscription plans, update payment methods, and download your previous
            invoices.
          </p>
        </div>
        <Button
          id="add-payment-method-btn"
          loading={portalLoading}
          disabled={portalLoading}
          onClick={() => void handleOpenPortal()}
        >
          {!portalLoading && <Plus className="size-4" aria-hidden="true" />}
          {portalLoading ? 'Opening portal...' : 'Add Payment Method'}
        </Button>
      </div>

      {(actionError || portalError) && (
        <div className="mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-[13px] text-error">
          {actionError ?? portalError}
        </div>
      )}

      {/* Primary Method */}
      {primaryMethod && (
        <>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.6px] text-text-tertiary">
            Primary Method
          </p>
          <div className="mb-7 flex flex-col gap-3">
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
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.6px] text-text-tertiary">
            Other Methods
          </p>
          <div className="mb-7 flex flex-col gap-3">
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
        <div className="py-12 text-center text-text-tertiary">
          <CreditCard className="mx-auto mb-2 size-10 text-text-tertiary" aria-hidden="true" />
          <p>No payment methods on file.</p>
        </div>
      )}

      {/* ===== Remove Confirmation Modal ===== */}
      <Dialog
        open={modal.type === 'confirm-delete'}
        onOpenChange={(open) => {
          if (!open) {
            setModal({ type: 'none' });
            setActionError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {modal.type === 'confirm-delete' && (
            <>
              <DialogHeader>
                <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
                  <AlertTriangle className="size-7" aria-hidden="true" />
                </div>
                <DialogTitle className="text-center">Remove payment method?</DialogTitle>
              </DialogHeader>
              <p className="text-center text-sm text-text-secondary">
                Are you sure you want to remove{' '}
                <strong className="text-foreground">
                  {modal.pm.brand.toUpperCase()} •••• {modal.pm.last4}
                </strong>{' '}
                from your account? You will no longer be charged using this method.
              </p>

              {actionError && <Alert variant="error">{actionError}</Alert>}

              <DialogFooter className="flex-col gap-2.5 sm:flex-col sm:space-x-0">
                <Button
                  variant="destructive"
                  className="w-full"
                  loading={actionLoading}
                  disabled={actionLoading}
                  onClick={() => void handleDelete(modal.pm)}
                >
                  {actionLoading ? 'Removing...' : 'Remove Payment Method'}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setModal({ type: 'none' });
                    setActionError(null);
                  }}
                >
                  Cancel
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Success Modal ===== */}
      <Dialog
        open={modal.type === 'delete-success'}
        onOpenChange={(open) => {
          if (!open) setModal({ type: 'none' });
        }}
      >
        <DialogContent className="sm:max-w-md">
          {modal.type === 'delete-success' && (
            <>
              <DialogHeader>
                <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
                  <Check className="size-7" aria-hidden="true" />
                </div>
                <DialogTitle className="text-center">Payment method removed</DialogTitle>
              </DialogHeader>
              <p className="text-center text-sm text-text-secondary">
                The card <strong className="text-foreground">({modal.pmLabel})</strong> has been
                successfully removed from your account. You will no longer be charged using this
                method.
              </p>
              <DialogFooter className="flex-col gap-2.5 sm:flex-col sm:space-x-0">
                <Button className="w-full" onClick={() => setModal({ type: 'none' })}>
                  Return to Billing
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setModal({ type: 'none' })}
                >
                  Back to Payment Methods
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
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
    <div className="flex items-center gap-4 rounded-xl border border-border bg-background px-5 py-4">
      <div className="flex h-8 w-[50px] shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold uppercase tracking-[0.5px] text-primary">
        {pm.brand.slice(0, 4)}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">
          {brandLabel} •••• {pm.last4}
          {pm.isDefault && (
            <span className="ml-2 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Default
            </span>
          )}
        </p>
        <span className="text-xs text-text-secondary">
          Expires {String(pm.expMonth).padStart(2, '0')}/{pm.expYear}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {!pm.isDefault && (
          <button
            className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            disabled={actionLoading}
            onClick={onSetDefault}
          >
            Set as Default
          </button>
        )}
        <button
          className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-error hover:bg-error/10 disabled:opacity-50"
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
