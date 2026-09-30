import React from 'react';
import Link from 'next/link';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { DASHBOARD_BANNER_SHELL } from '@/components/dashboard/banner-shell';
import { REMINDER_STAGE_DEFAULTS } from '@/lib/reminders/stages';

interface Props {
  /**
   * Overdue ASSIGNMENTS past their hard-escalation point. The point is resolved
   * per assignment, so this is neither a head count nor a fixed number of days.
   */
  hardEscalationCount: number;
}

const DEFAULT_ESCALATION_DAYS = REMINDER_STAGE_DEFAULTS.HARD_ESCALATION.offsetDays;

/**
 * Site-wide banner shown to admins when one or more overdue assignments have
 * passed their hard-escalation point, so the compliance risk is visible
 * everywhere — not only on the status-tracker page. Self-clears once the
 * underlying enrollments are completed (the count drops to zero). Renders
 * nothing when there is no hard escalation. Modeled on {@link BillingPausedBanner}.
 */
export default function StatusTrackerAlertBanner({ hardEscalationCount }: Props) {
  if (hardEscalationCount <= 0) return null;

  const [subject, verb] =
    hardEscalationCount === 1
      ? ['overdue assignment has passed its', 'needs']
      : ['overdue assignments have passed their', 'need'];

  return (
    <div className={`${DASHBOARD_BANNER_SHELL} border-[#fda29b] bg-[#fef3f2]`} role="alert">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[#d92d20]" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-semibold text-[#912018]">Training overdue — action needed</p>
          <p className="text-[#b42318]">
            {hardEscalationCount} {subject} escalation point ({DEFAULT_ESCALATION_DAYS}+ days by
            default) and {verb} attention.
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
