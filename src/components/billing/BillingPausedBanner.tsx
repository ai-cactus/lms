'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PauseCircle, Play, Loader2, X } from 'lucide-react';
import { logger } from '@/lib/logger';
import type { PauseState } from '@/lib/billing';
import { DASHBOARD_BANNER_SHELL } from '@/components/dashboard/banner-shell';

/**
 * The states this banner can actually be in. `getPauseState` never returns
 * 'pending' — a scheduled pause is resolved separately by `hasPendingPause`,
 * because access is untouched until it starts.
 */
type BannerPauseState = Exclude<PauseState, 'none'> | 'pending';

/** The page that owns the subscription controls this banner would duplicate. */
const BILLING_PAGE_PATH = '/dashboard/billing';

interface Props {
  /** 'pending' is a REQUESTED pause that has not taken effect — access is intact. */
  pauseState: BannerPauseState;
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
 * Keyed by the pause it describes, so resuming and pausing again — or a paused
 * subscription tipping over into `expired` — surfaces the banner afresh instead
 * of inheriting an earlier dismissal.
 */
function dismissalKey(pauseState: BannerPauseState, pauseEndsAt: string | null): string {
  return `billing-paused-banner-dismissed:${pauseState}:${pauseEndsAt ?? 'open-ended'}`;
}

/**
 * Site-wide banner shown to admins while billing is paused, so the paused state
 * (and the continue/cancel decision once it expires) is visible everywhere —
 * not only on the billing page.
 *
 * It stands down on `/dashboard/billing` itself, which owns the real control:
 * the subscription tab already carries a status-aware "Update Plan" action, and
 * rendering this banner there put two resume buttons on one screen (they even
 * raced each other — see the import note in BillingPage.tsx).
 *
 * A scheduled pause can be dismissed for the current tab only: the subscription
 * is still paused afterwards, so the notice must return on reload and in a new
 * tab rather than being silenced for good. The `expired` state is deliberately
 * not dismissible — it is a blocking continue-or-cancel decision with no end
 * date that will clear it on its own.
 */
export default function BillingPausedBanner({
  pauseState,
  pauseStartsAt = null,
  pauseEndsAt,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const expired = pauseState === 'expired';
  const pending = pauseState === 'pending';
  const dismissible = !expired;

  // Read after mount, never during render: the server has no sessionStorage, so
  // seeding this from storage in the initial state would desync hydration.
  useEffect(() => {
    if (!dismissible) return;
    try {
      if (window.sessionStorage.getItem(dismissalKey(pauseState, pauseEndsAt)) === '1') {
        setDismissed(true);
      }
    } catch (err) {
      // Storage access throws outright in some privacy modes. Leaving the
      // banner visible is the safe outcome for a billing notice, so this
      // degrades rather than failing — but it is still recorded.
      logger.debug({ msg: '[billing] Could not read paused-banner dismissal', err });
    }
  }, [dismissible, pauseState, pauseEndsAt]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(dismissalKey(pauseState, pauseEndsAt), '1');
    } catch (err) {
      // The banner still hides for this render; it simply returns on the next
      // navigation because the choice could not be stored.
      logger.debug({ msg: '[billing] Could not persist paused-banner dismissal', err });
    }
  }, [pauseState, pauseEndsAt]);

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

  // Query strings are not part of `pathname`, so this covers every `?tab=`.
  // Deliberately an exact match: /dashboard/billing/cancel is a separate page
  // with no resume control of its own.
  if (pathname === BILLING_PAGE_PATH) return null;

  if (dismissed) return null;

  return (
    <div
      className={[
        DASHBOARD_BANNER_SHELL,
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
        {dismissible && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={handleDismiss}
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
