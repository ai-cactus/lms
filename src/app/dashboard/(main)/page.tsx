import React from 'react';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import DashboardCharts from '@/components/dashboard/DashboardChartsDynamic';
import MyCoursesTable from '@/components/dashboard/MyCoursesTable';
import { getDashboardData } from '@/app/actions/course';
import DashboardEmptyState from '@/components/dashboard/DashboardEmptyState';
import DashboardCreateCourseButton from '@/components/dashboard/DashboardCreateCourseButton';
import StatusTrackerOverview from '@/components/dashboard/status-tracker/StatusTrackerOverview';
import { hasActiveBilling } from '@/lib/billing';
import { isWorkerRole, dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import type { Role } from '@/types/next-auth';
import { getStatusTrackerSummaryForOrg } from '@/lib/reminders/status-tracker';
import Link from 'next/link';
import { BookOpen, Users, BadgeCheck } from 'lucide-react';
import {
  isOrgWideFacilityRole,
  listAccessibleFacilities,
  resolveFacilityScopeSelection,
} from '@/lib/facility/scope';
import { getGlobalDashboardData } from '@/app/actions/dashboard-facility';
import GlobalDashboardView from '@/components/dashboard/global/GlobalDashboardView';
import FacilityScopeSwitcher from '@/components/dashboard/FacilityScopeSwitcher';

interface DashboardPageProps {
  searchParams: Promise<{ facility?: string | string[] }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = session.user.role;
  if (isWorkerRole(role)) redirect('/worker');

  const organizationId = session.user.organizationId;

  // Scope comes from the URL, never the session: switching facilities must not
  // mint a new token, and a stale token must not carry a facility the user has
  // since lost. `resolveFacilityScopeSelection` re-derives the accessible set per
  // request and drops any id the caller may not view.
  const { facility: facilityParam } = await searchParams;
  const scope = await resolveFacilityScopeSelection(session, facilityParam);

  // Roster-wide training and compliance data — same gate as the Status Tracker
  // widget below, so finance (an admin-tier role) keeps its own dashboard.
  const canSeeRosterMetrics = can(dbRoleToRoleKey(role as Role), 'assignment.read');

  // A comparison is the Global View narrowed to the selected facilities, so it
  // takes the same branch as the unscoped request.
  if (canSeeRosterMetrics && scope.mode !== 'single') {
    const globalData = await getGlobalDashboardData();
    // `facilities` is what THIS viewer can see, so one condition covers every
    // case: a single-facility organisation, and a role bound to one facility,
    // both get that facility's dashboard rather than a consolidated view of a
    // single site. Two or more is the only shape a global view can describe.
    if (globalData.facilities.length > 1) {
      return (
        <GlobalDashboardView
          data={globalData}
          userName={session.user.name}
          comparedFacilityIds={
            scope.mode === 'compare' ? scope.facilities.map((facility) => facility.id) : []
          }
        />
      );
    }
  }

  const scopedFacility = scope.mode === 'single' ? scope.facility : null;

  // Fetch billing status alongside dashboard data so the Create Course button
  // can apply the same billing gate as the Courses list page.
  const [{ courses, stats }, organization, accessibleFacilities] = await Promise.all([
    getDashboardData(scopedFacility?.id),
    organizationId
      ? prisma.organization.findUnique({
          where: { id: organizationId },
          select: { subscription: { select: { status: true, pausedAt: true } } },
        })
      : null,
    listAccessibleFacilities(session),
  ]);

  const hasBilling = hasActiveBilling(organization?.subscription);

  // The security boundary for this page's roster reads, mirroring
  // `requirePermissionWithFacilityScope`: null (no predicate) ONLY for an
  // org-wide role viewing everything. A facility-bound role always gets an
  // array — reaching this branch without a `?facility=` selection must narrow
  // to their own facilities, never widen to the organisation.
  const dataFacilityIds = scopedFacility
    ? [scopedFacility.id]
    : isOrgWideFacilityRole(role as Role)
      ? null
      : accessibleFacilities.map((facility) => facility.id);

  // Status Tracker overview — gated on roster-wide assignment visibility so
  // finance (an admin-tier role) never sees worker-training metrics.
  const statusTracker =
    canSeeRosterMetrics && organizationId
      ? await getStatusTrackerSummaryForOrg(
          organizationId,
          new Date(),
          dataFacilityIds ?? undefined,
        )
      : { overdueCount: 0, hardEscalationCount: 0, rows: [], nearDeadline: { count: 0, rows: [] } };

  // Merge overdue + due-soon rows (same order as the full Status Tracker page:
  // most-overdue first, then soonest-due) and serialize Date across the
  // server/client boundary.
  const statusTrackerRows = [
    ...statusTracker.rows.map((row) => ({
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
    ...statusTracker.nearDeadline.rows.map((row) => ({
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

  const totalCourses = stats?.totalCourses || 0;
  const totalStaffAssigned = stats?.totalStaffAssigned || 0;
  const averageGrade = stats?.averageGrade || 0;

  const summaryCards = [
    {
      label: 'Total Courses',
      value: String(totalCourses),
      icon: BookOpen,
      surface: 'border-[#9be3c2] bg-[#e9f9f2]',
      iconSurface: 'bg-[#16a34a]',
    },
    {
      label: 'Total Staff Assigned',
      value: String(totalStaffAssigned),
      icon: Users,
      surface: 'border-[#9ba7e3] bg-[#e9ecf9]',
      iconSurface: 'bg-[#162ea3]',
    },
    {
      label: 'Average Grade',
      value: `${averageGrade}%`,
      icon: BadgeCheck,
      surface: 'border-[#e39b9b] bg-[#f9e9e9]',
      iconSurface: 'bg-[#cd1515]',
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-[30px]">
      <div className="flex flex-col gap-[5px] px-1 py-0.5">
        <p className="text-xs font-medium md:text-sm">
          <Link href="/dashboard" className="text-[#a0aec0] hover:underline">
            Home
          </Link>
          <span className="text-[#a0aec0]"> / </span>
          <span className="text-[#2d3748]">{scopedFacility?.name ?? 'Training'}</span>
        </p>
        <div className="flex flex-col gap-[5px] px-1 py-0.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.88px] text-[#272b30] md:text-[28px] md:tracking-[-1.12px] xl:text-[33.5px] xl:leading-[44px] xl:tracking-[-1.34px]">
              Dashboard
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <FacilityScopeSwitcher
                facilities={accessibleFacilities}
                selectedFacilityIds={scopedFacility ? [scopedFacility.id] : []}
              />
              <DashboardCreateCourseButton hasBilling={hasBilling} />
            </div>
          </div>
          <p className="text-sm leading-[28px] text-[#525252] md:text-base xl:text-lg">
            {/*
              Team QA #8: an org-wide role was being shown facility framing. The
              DATA was never facility-scoped — getDashboardData(undefined)
              resolves to an empty facilityFilter — but the copy said otherwise,
              which is what the report describes as "showing facility view
              dashboard, instead of global view".
            */}
            {scopedFacility
              ? 'Here is an overview of your facility'
              : isOrgWideFacilityRole(role as Role)
                ? 'Here is an overview across your organisation'
                : 'Here is an overview of your courses'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {summaryCards.map(({ label, value, icon: Icon, surface, iconSurface }) => (
          <div
            key={label}
            className={`flex flex-col gap-[18px] overflow-hidden rounded-[22px] border p-4 md:gap-[31px] md:p-6 ${surface}`}
          >
            <div
              className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] text-white shadow-[0px_3.9px_3.064px_0px_rgba(0,0,0,0.02)] md:size-[50px] md:rounded-[13px] ${iconSurface}`}
            >
              <Icon className="size-[18px] md:size-[25px]" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-[7px]">
              <p className="text-[13px] font-semibold leading-4 tracking-[-0.16px] text-[#6f767e] md:text-base">
                {label}
              </p>
              <p className="text-[22px] font-bold leading-[1.4] text-[#262626] md:text-[30.5px]">
                {value}
              </p>
            </div>
          </div>
        ))}
      </div>

      <DashboardCharts stats={stats} />

      <MyCoursesTable courses={courses} maxItems={5} />

      {canSeeRosterMetrics && <StatusTrackerOverview rows={statusTrackerRows} />}

      <DashboardEmptyState totalCourses={totalCourses} />
    </div>
  );
}
