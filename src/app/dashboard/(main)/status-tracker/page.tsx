import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import type { Role } from '@/types/next-auth';
import StatusTrackerTableClient, {
  type StatusTrackerRowView,
} from '@/components/dashboard/status-tracker/StatusTrackerTableClient';
import NearDeadlineTable, {
  type NearDeadlineRowView,
} from '@/components/dashboard/status-tracker/NearDeadlineTable';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Status Tracker | Theraptly LMS',
  description: 'Workers with overdue training that needs attention.',
};

export default async function StatusTrackerPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  // Roster-wide assignment visibility gates this page (finance is excluded from
  // worker training metrics even though it is an admin-tier role).
  if (!user || !can(dbRoleToRoleKey(user.role as Role), 'assignment.read')) {
    redirect('/dashboard');
  }

  const summary = user.organizationId
    ? await getStatusTrackerSummaryForOrg(user.organizationId)
    : {
        overdueCount: 0,
        hardEscalationCount: 0,
        rows: [],
        nearDeadline: { count: 0, rows: [] },
      };

  // Serialize Date across the server/client boundary.
  const rows: StatusTrackerRowView[] = summary.rows.map((row) => ({
    ...row,
    dueAt: row.dueAt.toISOString(),
  }));

  const nearDeadlineRows: NearDeadlineRowView[] = summary.nearDeadline.rows.map((row) => ({
    ...row,
    dueAt: row.dueAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-7">
        <h1 className="mb-1 text-[28px] font-bold text-foreground">Status Tracker</h1>
        <p className="text-sm text-text-tertiary">
          Workers with training past its deadline, plus training coming due in the next 7 days.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-background p-5">
          <p className="text-sm text-text-secondary">Overdue training</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{summary.overdueCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-background p-5">
          <p className="text-sm text-text-secondary">Hard escalations</p>
          <p
            className={[
              'mt-1 text-2xl font-bold',
              summary.hardEscalationCount > 0 ? 'text-error' : 'text-foreground',
            ].join(' ')}
          >
            {summary.hardEscalationCount}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background p-5">
          <p className="text-sm text-text-secondary">Due in next 7 days</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{summary.nearDeadline.count}</p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <StatusTrackerTableClient rows={rows} />
        <NearDeadlineTable rows={nearDeadlineRows} />
      </div>
    </div>
  );
}
