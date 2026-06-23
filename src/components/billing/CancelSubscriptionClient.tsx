'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, PauseCircle, XCircle, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';
import { MAX_PAUSE_MONTHS } from '@/lib/billing';
import { cn } from '@/lib/utils';

interface Props {
  planName: string;
  periodEnd: string;
  pausedAt: string | null;
  pauseEndsAt: string | null;
}

const CANCEL_REASONS = [
  'Platform no longer needed',
  "Didn't see value relative to price",
  'Needed more features temporarily',
  'Poor product performance',
  "Didn't need all the features included",
  'Product too difficult to use',
  'Missing features',
  'Insufficient customer support',
  'Changes to my budget',
  'Upgraded temporarily for more support',
  'Reason not listed',
];

const PAUSE_MONTH_OPTIONS = Array.from({ length: MAX_PAUSE_MONTHS }, (_, i) => i + 1);

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function CancelSubscriptionClient({ planName, periodEnd, pausedAt }: Props) {
  const router = useRouter();
  const alreadyPaused = !!pausedAt;

  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const [pauseMonths, setPauseMonths] = useState<number>(MAX_PAUSE_MONTHS);
  const pauseMenuRef = useRef<HTMLDivElement>(null);

  const [pauseModal, setPauseModal] = useState({ open: false, loading: false, error: '' });
  const [cancelModal, setCancelModal] = useState({ open: false, loading: false, error: '' });

  // Close the "Pause Instead" menu when clicking outside it.
  useEffect(() => {
    if (!pauseMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pauseMenuRef.current && !pauseMenuRef.current.contains(e.target as Node)) {
        setPauseMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [pauseMenuOpen]);

  const openPauseModal = (months: number) => {
    setPauseMonths(months);
    setPauseMenuOpen(false);
    setPauseModal({ open: true, loading: false, error: '' });
  };

  const handlePause = useCallback(async () => {
    setPauseModal((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await fetch('/api/billing/subscription/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: pauseMonths }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to pause subscription');
      router.push('/dashboard/billing');
      router.refresh();
    } catch (err) {
      setPauseModal((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Unexpected error',
      }));
    }
  }, [pauseMonths, router]);

  const handleCancel = useCallback(async () => {
    setCancelModal((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await fetch('/api/billing/subscription/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to cancel subscription');
      router.push('/dashboard/billing');
      router.refresh();
    } catch (err) {
      setCancelModal((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Unexpected error',
      }));
    }
  }, [reason, router]);

  return (
    <div className="min-h-full bg-background-secondary px-4 py-6 md:px-10 md:py-8">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-text-secondary">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-background-secondary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Go Back
        </button>
        <span className="text-text-tertiary">
          <Link href="/dashboard/billing" className="hover:text-primary">
            Billing
          </Link>{' '}
          / <span className="text-primary">Cancel Subscription</span>
        </span>
      </div>

      {/* Header row */}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-bold text-foreground md:text-[28px]">
          Cancel {planName} Service
        </h1>
        <div className="flex items-center gap-3">
          {/* Pause Instead dropdown — hidden when already paused */}
          <div className={cn('relative', alreadyPaused && 'hidden')} ref={pauseMenuRef}>
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-[#1e293b] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-foreground"
              onClick={() => setPauseMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={pauseMenuOpen}
            >
              Pause Instead
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
            {pauseMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
              >
                {PAUSE_MONTH_OPTIONS.map((m) => (
                  <button
                    key={m}
                    role="menuitem"
                    className="block w-full px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-background-secondary"
                    onClick={() => openPauseModal(m)}
                  >
                    {m} {m === 1 ? 'Month' : 'Months'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button
            variant="destructive"
            disabled={!acknowledged}
            onClick={() => setCancelModal({ open: true, loading: false, error: '' })}
          >
            Cancel
          </Button>
        </div>
      </div>

      {/* Acknowledgement box */}
      <label className="mb-8 flex cursor-pointer items-start gap-3 rounded-xl border border-error/30 bg-error/5 p-5">
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(v) => setAcknowledged(v === true)}
          className="mt-0.5"
        />
        <span className="text-sm leading-relaxed text-error">
          If you cancel now, you will still have access to your {planName} subscription until{' '}
          <strong>{formatLongDate(periodEnd)}</strong>.
          <br />I understand that if I cancel, Theraptly&apos;s features will be disabled on my
          domains.
        </span>
      </label>

      <div className="mb-6 h-px bg-border" />

      {/* Reasons survey */}
      <h2 className="mb-1.5 text-lg font-bold text-foreground">
        We&apos;d love to know why you chose to cancel your subscription
      </h2>
      <p className="mb-6 text-sm text-text-secondary">
        Please choose the strongest reason that influenced your decision the most.
      </p>

      <div className="grid grid-cols-1 gap-x-12 gap-y-4 sm:grid-cols-2">
        {CANCEL_REASONS.map((r) => {
          const selected = reason === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className="flex items-center gap-3 text-left text-sm text-foreground"
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                  selected ? 'border-primary' : 'border-border',
                )}
              >
                {selected && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
              {r}
            </button>
          );
        })}
      </div>

      {/* ===== Taking a Break (pause) modal ===== */}
      <Dialog
        open={pauseModal.open}
        onOpenChange={(open) => {
          if (!open) setPauseModal((s) => ({ ...s, open: false }));
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-warning/10 text-warning">
              <PauseCircle size={28} aria-hidden="true" />
            </div>
            <DialogTitle className="text-center">Taking a Break?</DialogTitle>
          </DialogHeader>
          <p className="text-center text-sm text-text-secondary">
            Pause your subscription and keep your courses, training records, certificates, and
            compliance history securely stored until you return.
          </p>

          <div>
            <label
              htmlFor="pause-months"
              className="mb-1.5 block text-[13px] font-medium text-text-secondary"
            >
              Pause duration
            </label>
            <select
              id="pause-months"
              className="box-border w-full cursor-pointer appearance-none rounded-[10px] border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/10"
              value={pauseMonths}
              disabled={pauseModal.loading}
              onChange={(e) => setPauseMonths(Number(e.target.value))}
            >
              {PAUSE_MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} {m === 1 ? 'Month' : 'Months'}
                </option>
              ))}
            </select>
          </div>

          {pauseModal.error && (
            <Alert variant="error" role="alert">
              {pauseModal.error}
            </Alert>
          )}

          <div className="flex gap-2.5">
            <Button
              variant="outline"
              className="flex-1"
              disabled={pauseModal.loading}
              onClick={() => setPauseModal((s) => ({ ...s, open: false }))}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              loading={pauseModal.loading}
              disabled={pauseModal.loading}
              onClick={() => void handlePause()}
            >
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Cancel subscription confirmation modal ===== */}
      <Dialog
        open={cancelModal.open}
        onOpenChange={(open) => {
          if (!open) setCancelModal((s) => ({ ...s, open: false }));
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
              <XCircle size={28} aria-hidden="true" />
            </div>
            <DialogTitle className="text-center">Cancel subscription</DialogTitle>
          </DialogHeader>
          <p className="text-center text-sm text-text-secondary">
            You will lose access to:{' '}
            <strong className="text-foreground">Staff training assignments</strong>,{' '}
            <strong className="text-foreground">Compliance tracking</strong>,{' '}
            <strong className="text-foreground">Audit Reports exports</strong>.
          </p>
          <p className="text-center text-xs text-text-tertiary">
            Your plan stays active until {formatLongDate(periodEnd)}.
          </p>

          {cancelModal.error && (
            <Alert variant="error" role="alert">
              {cancelModal.error}
            </Alert>
          )}

          <div className="flex gap-2.5">
            <Button
              variant="outline"
              className="flex-1"
              disabled={cancelModal.loading}
              onClick={() => setCancelModal((s) => ({ ...s, open: false }))}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              loading={cancelModal.loading}
              disabled={cancelModal.loading}
              onClick={() => void handleCancel()}
            >
              <Check className="size-4" aria-hidden="true" />
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
