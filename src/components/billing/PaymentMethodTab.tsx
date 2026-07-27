'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Loader2, AlertTriangle, Check, MapPin, Trash2 } from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';
import BillingPageHeader from './BillingPageHeader';
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

const brandBoxClass =
  'flex h-[32px] w-[48px] shrink-0 items-center justify-center rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] text-[10px] font-bold tracking-[0.5px] text-[#475569] uppercase';

function brandLabel(brand: string): string {
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function hasBillingAddress(pm: PaymentMethod): boolean {
  return Boolean(pm.billingDetails.name || pm.billingDetails.address?.line1);
}

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
      <div className="mb-10">
        <BillingPageHeader
          title="Payment Method"
          subtitle="Manage your subscription plans, update payment methods, and download your previous invoices."
          action={
            <Button
              id="add-payment-method-btn"
              loading={portalLoading}
              disabled={portalLoading}
              onClick={() => void handleOpenPortal()}
            >
              {!portalLoading && <Plus className="size-4" aria-hidden="true" />}
              {portalLoading ? 'Opening portal...' : 'Add Payment Method'}
            </Button>
          }
        />
      </div>

      {(actionError || portalError) && (
        <div className="mb-4 rounded-[8px] border border-error/40 bg-error/10 px-4 py-2.5 text-[13px] text-error">
          {actionError ?? portalError}
        </div>
      )}

      {primaryMethod && (
        <div className="mb-10 flex flex-col gap-8 rounded-[12px] border border-[#e2e8f0] bg-white p-[25px] shadow-[0px_1px_1px_0px_rgba(0,0,0,0.05)]">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-4">
              <div className={brandBoxClass}>{primaryMethod.brand.slice(0, 4)}</div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[16px] leading-[24px] font-semibold text-[#0f172a]">
                    {brandLabel(primaryMethod.brand)} •••• {primaryMethod.last4}
                  </p>
                  <span className="rounded-[4px] bg-[#edeffe] px-1.5 py-0.5 text-[10px] leading-[15px] font-bold tracking-[0.5px] text-primary uppercase">
                    Default
                  </span>
                </div>
                <span className="text-[14px] leading-[20px] text-[#64748b]">
                  Expires {String(primaryMethod.expMonth).padStart(2, '0')}/{primaryMethod.expYear}
                </span>
              </div>
            </div>
            <button
              className="h-9 cursor-pointer rounded-[8px] border border-[#e2e8f0] px-[17px] text-[14px] leading-[20px] font-medium text-[#dc2626] transition-colors hover:bg-[#fef2f2] disabled:opacity-50"
              disabled={actionLoading}
              onClick={() => setModal({ type: 'confirm-delete', pm: primaryMethod })}
              aria-label={`Remove ${brandLabel(primaryMethod.brand)} ending in ${primaryMethod.last4}`}
            >
              Remove
            </button>
          </div>

          {hasBillingAddress(primaryMethod) && (
            <div className="flex flex-col gap-3 border-t border-[#f1f5f9] pt-[25px]">
              <p className="text-[14px] leading-[20px] font-bold text-[#0f172a]">Billing Address</p>
              <div className="flex items-start gap-4">
                <MapPin className="mt-0.5 size-4 shrink-0 text-[#64748b]" aria-hidden="true" />
                <address className="text-[14px] leading-[22.75px] text-[#475569] not-italic">
                  {primaryMethod.billingDetails.name && (
                    <>
                      {primaryMethod.billingDetails.name}
                      <br />
                    </>
                  )}
                  {primaryMethod.billingDetails.address?.line1 && (
                    <>
                      {primaryMethod.billingDetails.address.line1}
                      <br />
                    </>
                  )}
                  {primaryMethod.billingDetails.address?.city && (
                    <>
                      {primaryMethod.billingDetails.address.city}
                      {primaryMethod.billingDetails.address.state
                        ? `, ${primaryMethod.billingDetails.address.state}`
                        : ''}
                      {primaryMethod.billingDetails.address.postal_code
                        ? `, ${primaryMethod.billingDetails.address.postal_code}`
                        : ''}
                      <br />
                    </>
                  )}
                  {primaryMethod.billingDetails.address?.country}
                </address>
              </div>
            </div>
          )}
        </div>
      )}

      {otherMethods.length > 0 && (
        <>
          <h2 className="mb-4 text-[20px] leading-[28px] font-bold text-[#0f172a]">
            Other Methods
          </h2>
          <div className="mb-10 flex flex-col gap-3">
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

      {paymentMethods.length === 0 && <EmptyTableState message="No payment methods on file." />}

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
  const label = brandLabel(pm.brand);

  return (
    <div className="flex items-center gap-4 rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] px-6 py-4">
      <div className={brandBoxClass}>{pm.brand.slice(0, 4)}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] leading-[20px] font-semibold text-[#0f172a]">
          {label} •••• {pm.last4}
          {pm.isDefault && (
            <span className="ml-2 rounded-[4px] bg-[#edeffe] px-1.5 py-0.5 text-[10px] leading-[15px] font-bold tracking-[0.5px] text-primary uppercase">
              Default
            </span>
          )}
        </p>
        <span className="text-[12px] leading-[16px] text-[#64748b]">
          Expires {String(pm.expMonth).padStart(2, '0')}/{pm.expYear}
        </span>
      </div>
      <div className="flex items-center gap-4">
        {!pm.isDefault && (
          <button
            className="cursor-pointer rounded-[8px] text-[13px] leading-[20px] font-medium text-primary hover:underline disabled:opacity-50"
            disabled={actionLoading}
            onClick={onSetDefault}
          >
            Set as Default
          </button>
        )}
        <button
          className="flex cursor-pointer items-center justify-center rounded-[8px] p-1.5 text-[#dc2626] transition-colors hover:bg-[#fef2f2] disabled:opacity-50"
          disabled={actionLoading}
          onClick={onRemove}
          aria-label={`Remove ${label} ending in ${pm.last4}`}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
