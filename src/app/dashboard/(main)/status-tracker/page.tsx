import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { listAccessibleFacilities, resolveFacilityScopeSelection } from '@/lib/facility/scope';
import { FACILITY_SCOPE_PARAM } from '@/lib/facility/scope-param';
import FacilityScopeSwitcher from '@/components/dashboard/FacilityScopeSwitcher';
import type { Role } from '@/types/next-auth';
import StatusTrackerTableClient, {
  type StatusTrackerRowView,
} from '@/components/dashboard/status-tracker/StatusTrackerTableClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Status Tracker | Theraptly LMS',
  description: 'Workers with overdue training that needs attention.',
};

interface StatusTrackerPageProps {
  searchParams: Promise<{ [FACILITY_SCOPE_PARAM]?: string | string[] }>;
}

export default async function StatusTrackerPage({ searchParams }: StatusTrackerPageProps) {
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

  // Scope is URL state, mirroring the dashboard: the selection is re-validated
  // against the caller's accessible facilities on every request.
  const { facility: facilityParam } = await searchParams;
  const scope = await resolveFacilityScopeSelection(session, facilityParam);
  const scopedFacilityIds =
    scope.mode === 'single'
      ? [scope.facility.id]
      : scope.mode === 'compare'
        ? scope.facilities.map((facility) => facility.id)
        : [];
  const facilities = await listAccessibleFacilities(session);

  const summary = organizationId
    ? await getStatusTrackerSummaryForOrg(
        organizationId,
        undefined,
        scopedFacilityIds.length > 0 ? scopedFacilityIds : undefined,
      )
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
      facilityName: row.facilityName,
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
      facilityName: row.facilityName,
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
          <FacilityScopeSwitcher facilities={facilities} selectedFacilityIds={scopedFacilityIds} />
        </div>
      </header>

      <StatusTrackerTableClient rows={rows} />
    </div>
  );
}
