import React from 'react';
import {
  BookOpen,
  CircleCheckBig,
  ClipboardClock,
  GraduationCap,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  UserRoundMinus,
} from 'lucide-react';
import FacilityScopeSwitcher from '@/components/dashboard/FacilityScopeSwitcher';
import { EXPIRING_CREDENTIALS_WINDOW_DAYS, METRIC_DEFINITIONS } from '@/lib/facility/metrics';
import { buildFacilityComparison } from '@/lib/facility/comparison';
import type { GlobalDashboardData } from '@/app/actions/dashboard-facility';
import MetricGroup from './MetricGroup';
import PriorityRisksTable from './PriorityRisksTable';
import FacilitiesOverviewTable from './FacilitiesOverviewTable';

interface GlobalDashboardViewProps {
  data: GlobalDashboardData;
  /** Display name for the greeting; falls back to a generic welcome when absent. */
  userName?: string | null;
  /** Facilities to compare; fewer than two accessible ids keeps the full view. */
  comparedFacilityIds?: string[];
}

/**
 * The all-facilities ("Global View") dashboard: enterprise footprint, training
 * velocity and risk KPIs above two facility-level tables. Purely presentational —
 * every figure arrives pre-aggregated from `getGlobalDashboardData`, and a
 * comparison is a projection of that same payload.
 */
export default function GlobalDashboardView({
  data,
  userName,
  comparedFacilityIds = [],
}: GlobalDashboardViewProps) {
  const comparison = buildFacilityComparison(data, comparedFacilityIds);
  const { enterpriseFootprint, trainingVelocity, riskCompliance } = comparison ?? data;
  const facilitiesOverview = comparison?.facilitiesOverview ?? data.facilitiesOverview;
  const priorityRisks = comparison?.priorityRisks ?? data.priorityRisks;

  const completionPercentByFacilityId = Object.fromEntries(
    data.facilitiesOverview.map((row) => [row.facilityId, row.completionPercent]),
  );

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6">
      <div className="flex flex-col gap-4 px-1 py-0.5 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-text-secondary md:text-sm">My Dashboard</p>
          <h1 className="text-[22px] font-semibold tracking-[-0.88px] text-foreground md:text-[28px] md:tracking-[-1.12px]">
            {userName ? `Welcome back, ${userName}` : 'Welcome back'}
          </h1>
          <p className="text-sm text-text-secondary md:text-base">
            Here is an overview across all your facilities
          </p>
        </div>
        <FacilityScopeSwitcher
          facilities={data.facilities}
          selectedFacilityIds={comparison?.facilityIds ?? []}
          completionPercentByFacilityId={completionPercentByFacilityId}
        />
      </div>

      <MetricGroup
        title="Enterprise Footprint"
        metrics={[
          {
            label: 'Total Number of Facilities',
            value: String(enterpriseFootprint.totalFacilities.value),
            icon: ShieldCheck,
            iconSurface: 'bg-[#2563eb]',
            trendPercent: enterpriseFootprint.totalFacilities.trendPercent,
            higherIsBetter: true,
          },
          {
            label: 'Total Staff Count',
            value: String(enterpriseFootprint.totalStaff.value),
            icon: UserRound,
            iconSurface: 'bg-[#16a34a]',
            trendPercent: enterpriseFootprint.totalStaff.trendPercent,
            higherIsBetter: true,
          },
        ]}
      />

      <MetricGroup
        title="Training Velocity"
        metrics={[
          {
            label: 'Active Learners',
            description: METRIC_DEFINITIONS.activeLearners,
            value: String(trainingVelocity.activeLearners.value),
            icon: GraduationCap,
            iconSurface: 'bg-[#7c3aed]',
            trendPercent: trainingVelocity.activeLearners.trendPercent,
            higherIsBetter: true,
          },
          {
            label: 'Ongoing Courses',
            value: String(trainingVelocity.ongoingCourses.value),
            icon: BookOpen,
            iconSurface: 'bg-[#0d9488]',
            trendPercent: trainingVelocity.ongoingCourses.trendPercent,
            higherIsBetter: true,
          },
          {
            label: 'First-Time Pass Rate',
            value: `${trainingVelocity.firstTimePassRate.value}%`,
            icon: CircleCheckBig,
            iconSurface: 'bg-[#16a34a]',
            trendPercent: trainingVelocity.firstTimePassRate.trendPercent,
            higherIsBetter: true,
          },
        ]}
      />

      <MetricGroup
        title="Risk, Compliance & Deadlines (Urgent Attention Needed)"
        metrics={[
          {
            label: 'Overdue Trainings',
            description: METRIC_DEFINITIONS.overdueTrainings,
            value: String(riskCompliance.overdueTrainings.value),
            icon: TriangleAlert,
            iconSurface: 'bg-[#dc2626]',
            trendPercent: riskCompliance.overdueTrainings.trendPercent,
            higherIsBetter: false,
            tone: 'critical',
          },
          {
            label: 'Dormant Staff',
            description: METRIC_DEFINITIONS.dormantStaff,
            value: String(riskCompliance.dormantStaff.value),
            icon: UserRoundMinus,
            iconSurface: 'bg-[#f59e0b]',
            trendPercent: riskCompliance.dormantStaff.trendPercent,
            higherIsBetter: false,
          },
          {
            label: `Expiring Credentials (Next ${EXPIRING_CREDENTIALS_WINDOW_DAYS} Days)`,
            description: METRIC_DEFINITIONS.expiringCredentials,
            value: String(riskCompliance.expiringCredentials.value),
            icon: ClipboardClock,
            iconSurface: 'bg-[#dc2626]',
            trendPercent: riskCompliance.expiringCredentials.trendPercent,
            higherIsBetter: false,
          },
        ]}
      />

      <FacilitiesOverviewTable
        rows={facilitiesOverview}
        comparisonTotal={comparison?.totalFacilityCount}
      />
      <PriorityRisksTable rows={priorityRisks} comparisonTotal={comparison?.totalFacilityCount} />
    </div>
  );
}
