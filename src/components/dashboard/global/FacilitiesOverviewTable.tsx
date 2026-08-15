'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { METRIC_DEFINITIONS } from '@/lib/facility/metrics';
import type { FacilityOverviewRow } from '@/app/actions/dashboard-facility';
import { AuditReadinessChip, RiskLevelChip } from './FacilityChips';
import {
  FacilityNameCell,
  FacilityTableSection,
  facilityComparisonDescription,
  facilityTableHeadClass,
} from './table-parts';

/** Facilities surfaced before the row-count footer. */
const MAX_ROWS = 5;

interface FacilitiesOverviewTableProps {
  rows: FacilityOverviewRow[];
  /**
   * Accessible facility count, set only while a subset is being compared —
   * `rows` is then already narrowed to the selected facilities.
   */
  comparisonTotal?: number;
}

export default function FacilitiesOverviewTable({
  rows,
  comparisonTotal,
}: FacilitiesOverviewTableProps) {
  const router = useRouter();
  const topRows = rows.slice(0, MAX_ROWS);
  const comparing = comparisonTotal !== undefined;

  return (
    <FacilityTableSection
      title="Facilities Overview"
      description={
        comparing
          ? facilityComparisonDescription(rows.length, comparisonTotal)
          : 'Performance overview across all facilities'
      }
      shown={topRows.length}
      total={rows.length}
      comparing={comparing}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {/* w-full + max-w-0 make Facility the one flexible column: it absorbs
                whatever width the fixed-content columns leave over and truncates,
                so the table never widens past its container. */}
            <TableHead className={cn(facilityTableHeadClass, 'w-full rounded-l-[9px]')}>
              Facility
            </TableHead>
            <TableHead
              className={cn(facilityTableHeadClass, 'hidden @xl:table-cell')}
              title={METRIC_DEFINITIONS.staffCount}
            >
              Staff Count
            </TableHead>
            <TableHead
              className={cn(facilityTableHeadClass, 'hidden @2xl:table-cell')}
              title={METRIC_DEFINITIONS.activeTrainings}
            >
              Active Trainings
            </TableHead>
            {/* The header strip's right corner rides whichever column is last
                at the current container width, since the trailing columns are
                progressively revealed. */}
            <TableHead
              className={cn(facilityTableHeadClass, 'rounded-r-[9px] @md:rounded-r-none')}
              title={METRIC_DEFINITIONS.trainingCompletion}
            >
              Training Completion %
            </TableHead>
            <TableHead
              className={cn(
                facilityTableHeadClass,
                'hidden @md:table-cell @md:rounded-r-[9px] @3xl:rounded-r-none',
              )}
              title={METRIC_DEFINITIONS.auditReadiness}
            >
              Audit Readiness
            </TableHead>
            <TableHead
              className={cn(facilityTableHeadClass, 'hidden @3xl:table-cell @3xl:rounded-r-[9px]')}
              title={METRIC_DEFINITIONS.riskLevel}
            >
              Risk Level
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {topRows.length > 0 ? (
            topRows.map((row) => (
              <TableRow
                key={row.facilityId}
                onClick={() => router.push(`/dashboard?facility=${row.facilityId}`)}
                aria-label={`View dashboard for ${row.name}`}
                className="h-[68px] cursor-pointer"
              >
                <TableCell className="w-full max-w-0 px-4 py-3">
                  <FacilityNameCell name={row.name} type={row.type} />
                </TableCell>
                <TableCell className="hidden px-4 text-sm font-medium text-foreground @xl:table-cell">
                  {row.staffCount}
                </TableCell>
                <TableCell className="hidden px-4 text-sm font-medium text-foreground @2xl:table-cell">
                  {row.activeTrainings}
                </TableCell>
                <TableCell className="px-4 text-sm font-semibold text-foreground">
                  {row.completionPercent}%
                </TableCell>
                <TableCell className="hidden px-4 @md:table-cell">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-sm font-semibold text-foreground">
                      {row.auditReadinessPercent}%
                    </span>
                    <AuditReadinessChip level={row.auditReadiness} />
                  </div>
                </TableCell>
                <TableCell className="hidden px-4 @3xl:table-cell">
                  <RiskLevelChip level={row.riskLevel} />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <EmptyTableState
              message="No facilities to report on yet"
              subMessage="Completion and audit readiness appear once your organization has facilities with assigned training."
              colSpan={6}
              asTableRow
            />
          )}
        </TableBody>
      </Table>
    </FacilityTableSection>
  );
}
