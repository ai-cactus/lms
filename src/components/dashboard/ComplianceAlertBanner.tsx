import React from 'react';
import Link from 'next/link';
import { ShieldAlert, ArrowRight } from 'lucide-react';

interface Props {
  /** Number of enrollments overdue by the hard-escalation threshold (7+ days). */
  hardEscalationCount: number;
}

/**
 * Site-wide banner shown to admins when one or more workers have training overdue
 * by the hard-escalation threshold, so the compliance risk is visible everywhere —
 * not only on the compliance page. Self-clears once the underlying enrollments are
 * completed (the count drops to zero). Renders nothing when there is no hard
 * escalation. Modeled on {@link BillingPausedBanner}.
 */
export default function ComplianceAlertBanner({ hardEscalationCount }: Props) {
  if (hardEscalationCount <= 0) return null;

  const workerWord = hardEscalationCount === 1 ? 'worker has' : 'workers have';

  return (
    <div
      className="mb-6 flex flex-col items-start gap-3 border-b border-error/30 bg-error/10 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8"
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-error" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-semibold text-foreground">Training overdue — action needed</p>
          <p className="text-text-secondary">
            {hardEscalationCount} {workerWord} training overdue by 7+ days and need attention.
          </p>
        </div>
      </div>

      <Link
        href="/dashboard/compliance"
        className="inline-flex shrink-0 items-center gap-1.5 self-stretch rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-error/90 sm:self-auto"
      >
        Review compliance
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
