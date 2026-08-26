import React from 'react';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';
import { requirePermissionWithFacilityScope } from '@/lib/rbac/require-permission';
import { FACILITY_SCOPE_PARAM } from '@/lib/facility/scope-param';
import FacilityScopeSwitcher from '@/components/dashboard/FacilityScopeSwitcher';
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
  // D-01, fourth surface (unreported by the defect register). This page derived
  // its facility ids from the `?facility=` parameter alone. For a supervisor who
  // had not picked one, `scope.mode` is 'all' -> `[]` -> it passed `undefined`,
  // which getStatusTrackerSummaryForOrg maps to NO facility predicate. A
  // facility-bound supervisor therefore saw org-wide overdue enrollments,
  // including the names and emails of workers at facilities they do not manage.
  //
  // 'all' means "all facilities I CAN SEE", never "no filter". `dataFacilityIds`
  // encodes that distinction: null only for an org-wide role viewing all.
  const { facility: facilityParam } = await searchParams;
  const ctx = await requirePermissionWithFacilityScope('assignment.read', facilityParam);
  const { organizationId, dataFacilityIds } = ctx;
  const scopedFacilityIds = ctx.selectedFacilityIds;
  const facilities = ctx.accessibleFacilities;

  const summary = organizationId
    ? await getStatusTrackerSummaryForOrg(
        organizationId,
        undefined,
        // The security boundary — NOT `scopedFacilityIds`, which is view state.
        dataFacilityIds ?? undefined,
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
