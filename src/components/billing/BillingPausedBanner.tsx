'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PauseCircle, Play, Loader2 } from 'lucide-react';
import type { PauseState } from '@/lib/billing';

interface Props {
  /** 'pending' is a REQUESTED pause that has not taken effect — access is intact. */
  pauseState: Exclude<PauseState, 'none'> | 'pending';
  /** ISO timestamp the pause takes effect. Only meaningful when pending. */
  pauseStartsAt?: string | null;
  pauseEndsAt: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Site-wide banner shown to admins about the pause lifecycle, so it is visible
 * everywhere — not only on the billing page. Three variants:
 *   • pending — a pause is scheduled but has NOT taken effect; access is
 *     completely intact and the banner is purely informational + cancellable.
 *   • paused  — the pause is live and access is limited.
 *   • expired — the pause window elapsed; continue or cancel is now required.
 */
export default function BillingPausedBanner({
  pauseState,
  pauseStartsAt = null,
  pauseEndsAt,
}: Props) {
  const router = useRouter();
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expired = pauseState === 'expired';
  const pending = pauseState === 'pending';

  const handleResume = useCallback(async () => {
    setResuming(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/subscription/resume', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to resume subscription');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setResuming(false);
    }
  }, [router]);

  return (
    <div
      className={[
        'flex flex-col items-start gap-3 border-b px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8',
        expired ? 'border-error/30 bg-error/10' : 'border-warning/30 bg-warning/10',
      ].join(' ')}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <PauseCircle
          className={['mt-0.5 size-5 shrink-0', expired ? 'text-error' : 'text-warning'].join(' ')}
          aria-hidden="true"
        />
        <div className="text-sm">
          <p className="font-semibold text-foreground">
            {pending
              ? pauseStartsAt
                ? `Your subscription will pause on ${formatDate(pauseStartsAt)}`
                : 'Your subscription is scheduled to pause'
              : expired
                ? 'Your subscription pause has ended'
                : 'Your subscription is paused'}
          </p>
          <p className="text-text-secondary">
            {pending
              ? 'Nothing changes until then — you keep full access for the period you have already paid for.'
              : expired
                ? 'Continue your plan to restore access, or cancel your subscription.'
                : pauseEndsAt
                  ? `Access is limited until you continue. Paused until ${formatDate(pauseEndsAt)}.`
                  : 'Access is limited until you continue your plan.'}
            {error && <span className="ml-1 text-error">{error}</span>}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5 self-stretch sm:self-auto">
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
          {pending ? 'Cancel pause' : 'Continue Plan'}
        </button>
        <Link
          href={expired ? '/dashboard/billing/cancel' : '/dashboard/billing'}
          className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-background-secondary"
        >
          {expired ? 'Cancel Plan' : 'Manage billing'}
        </Link>
      </div>
    </div>
  );
}
