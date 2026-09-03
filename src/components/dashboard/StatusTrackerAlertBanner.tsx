import React from 'react';
import Link from 'next/link';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { DASHBOARD_BANNER_SHELL } from '@/components/dashboard/banner-shell';

interface Props {
  /** Number of enrollments overdue by the hard-escalation threshold (7+ days). */
  hardEscalationCount: number;
}

/**
 * Site-wide banner shown to admins when one or more workers have training overdue
 * by the hard-escalation threshold, so the compliance risk is visible everywhere —
 * not only on the status-tracker page. Self-clears once the underlying enrollments
 * are completed (the count drops to zero). Renders nothing when there is no hard
 * escalation. Modeled on {@link BillingPausedBanner}.
 */
export default function StatusTrackerAlertBanner({ hardEscalationCount }: Props) {
  if (hardEscalationCount <= 0) return null;

  const workerWord = hardEscalationCount === 1 ? 'worker has' : 'workers have';

  return (
    <div className={`${DASHBOARD_BANNER_SHELL} border-[#fda29b] bg-[#fef3f2]`} role="alert">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[#d92d20]" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-semibold text-[#912018]">Training overdue — action needed</p>
          <p className="text-[#b42318]">
            {hardEscalationCount} {workerWord} training overdue by 7+ days and need attention.
          </p>
        </div>
      </div>

      <Link
        href="/dashboard/status-tracker"
        className="inline-flex shrink-0 items-center gap-1.5 self-stretch rounded-[8px] bg-[#d92d20] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#b42318] sm:self-auto"
      >
        Open status tracker
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
