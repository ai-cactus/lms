import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import type { Role } from '@/types/next-auth';
import StatusTrackerTableClient, {
  type StatusTrackerRowView,
} from '@/components/dashboard/status-tracker/StatusTrackerTableClient';

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

  const { role, organizationId } = session.user;

  // Roster-wide assignment visibility gates this page (finance is excluded from
  // worker training metrics even though it is an admin-tier role).
  if (!can(dbRoleToRoleKey(role as Role), 'assignment.read')) {
    redirect('/dashboard');
  }

  const summary = organizationId
    ? await getStatusTrackerSummaryForOrg(organizationId)
    : {
        overdueCount: 0,
        hardEscalationCount: 0,
        rows: [],
        nearDeadline: { count: 0, rows: [] },
      };

  // Overdue first (most overdue first), then at-risk (soonest due first) — both
  // orderings come from the server query; Date is serialized for the client.
  const rows: StatusTrackerRowView[] = [
    ...summary.rows.map((row) => ({
      enrollmentId: row.enrollmentId,
      userId: row.userId,
      workerName: row.workerName,
      workerEmail: row.workerEmail,
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      dueAt: row.dueAt.toISOString(),
      daysOverdue: row.daysOverdue,
      daysUntilDue: null,
    })),
    ...summary.nearDeadline.rows.map((row) => ({
      enrollmentId: row.enrollmentId,
      userId: row.userId,
      workerName: row.workerName,
      workerEmail: row.workerEmail,
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      dueAt: row.dueAt.toISOString(),
      daysOverdue: null,
      daysUntilDue: row.daysUntilDue,
    })),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <header className="mb-[30px] flex flex-col gap-[5px]">
        <p className="text-sm leading-tight font-medium">
          <span className="text-[#a0aec0]">Trainings / </span>
          <span className="text-[#2d3748]">Status Tracker</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
            Status Tracker
          </h1>
          {rows.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-[7px] rounded-full bg-[#fee4e2] px-[14px] py-1.5 text-[13px] font-semibold whitespace-nowrap text-[#b42318] sm:text-[14.4px]">
              <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-[#d92d20]" />
              {rows.length} at risk
            </span>
          )}
        </div>
      </header>

      <StatusTrackerTableClient rows={rows} />
    </div>
  );
}
