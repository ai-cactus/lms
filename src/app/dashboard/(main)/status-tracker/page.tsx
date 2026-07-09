import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';
import { REMINDER_STAGE_DEFAULTS } from '@/lib/reminders/stages';
import { isAdminRole } from '@/lib/rbac/role-utils';
import StatusTrackerTableClient, {
  type StatusTrackerRowView,
} from '@/components/dashboard/status-tracker/StatusTrackerTableClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Status Tracker | Theraptly LMS',
  description: 'Workers with overdue training that needs attention.',
};

const HARD_THRESHOLD_DAYS = REMINDER_STAGE_DEFAULTS.HARD_ESCALATION.offsetDays;

export default async function StatusTrackerPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  // Only admin users may access this page.
  if (!user || !isAdminRole(user.role)) {
    redirect('/dashboard');
  }

  const summary = user.organizationId
    ? await getStatusTrackerSummaryForOrg(user.organizationId)
    : { overdueCount: 0, hardEscalationCount: 0, rows: [] };

  // Serialize Date across the server/client boundary.
  const rows: StatusTrackerRowView[] = summary.rows.map((row) => ({
    ...row,
    dueAt: row.dueAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-7">
        <h1 className="mb-1 text-[28px] font-bold text-foreground">Status Tracker</h1>
        <p className="text-sm text-text-tertiary">
          Workers with training past its deadline. Escalations of {HARD_THRESHOLD_DAYS}+ days are
          highlighted.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-background p-5">
          <p className="text-sm text-text-secondary">Overdue training</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{summary.overdueCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-background p-5">
          <p className="text-sm text-text-secondary">
            Hard escalations ({HARD_THRESHOLD_DAYS}+ days)
          </p>
          <p
            className={[
              'mt-1 text-2xl font-bold',
              summary.hardEscalationCount > 0 ? 'text-error' : 'text-foreground',
            ].join(' ')}
          >
            {summary.hardEscalationCount}
          </p>
        </div>
      </div>

      <StatusTrackerTableClient rows={rows} hardThresholdDays={HARD_THRESHOLD_DAYS} />
    </div>
  );
}
