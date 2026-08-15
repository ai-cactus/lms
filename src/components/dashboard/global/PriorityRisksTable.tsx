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
import type { PriorityRiskRow } from '@/app/actions/dashboard-facility';
import { RiskLevelChip } from './FacilityChips';
import {
  FacilityNameCell,
  FacilityTableSection,
  facilityComparisonDescription,
  facilityTableHeadClass,
} from './table-parts';

/** Facilities surfaced before the row-count footer. */
const MAX_ROWS = 5;

interface PriorityRisksTableProps {
  /** Every accessible facility, already sorted most at risk first. */
  rows: PriorityRiskRow[];
  /**
   * Accessible facility count, set only while a subset is being compared —
   * `rows` is then already narrowed to the selected facilities.
   */
  comparisonTotal?: number;
}

export default function PriorityRisksTable({ rows, comparisonTotal }: PriorityRisksTableProps) {
  const router = useRouter();
  const topRows = rows.slice(0, MAX_ROWS);
  const comparing = comparisonTotal !== undefined;

  return (
    <FacilityTableSection
      title="Priority Risks & Deadlines by Facilities"
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
            {/* Same flexible-first-column pattern as FacilitiesOverviewTable —
                the Facility column absorbs the leftover width and truncates. */}
            <TableHead className={cn(facilityTableHeadClass, 'w-full rounded-l-[9px]')}>
              Facility
            </TableHead>
            <TableHead
              className={cn(facilityTableHeadClass, 'hidden @md:table-cell')}
              title={METRIC_DEFINITIONS.activeLearners}
            >
              Active Learners
            </TableHead>
            <TableHead
              className={cn(facilityTableHeadClass, 'hidden @2xl:table-cell')}
              title={METRIC_DEFINITIONS.approachingDeadlines}
            >
              Approaching Deadlines
            </TableHead>
            {/* The header strip's right corner rides whichever column is last
                at the current container width, since Risk Level is only
                revealed on the widest containers. */}
            <TableHead
              className={cn(facilityTableHeadClass, 'rounded-r-[9px] @3xl:rounded-r-none')}
              title={METRIC_DEFINITIONS.overdueTrainings}
            >
              Overdue Trainings
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
                <TableCell className="hidden px-4 text-sm font-medium text-foreground @md:table-cell">
                  {row.activeLearners}
                </TableCell>
                <TableCell className="hidden px-4 text-sm font-medium text-foreground @2xl:table-cell">
                  {row.approachingDeadlines}
                </TableCell>
                <TableCell
                  className={cn(
                    'px-4 text-sm font-semibold',
                    row.overdueTrainings > 0 ? 'text-error' : 'text-foreground',
                  )}
                >
                  {row.overdueTrainings}
                </TableCell>
                <TableCell className="hidden px-4 @3xl:table-cell">
                  <RiskLevelChip level={row.riskLevel} />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <EmptyTableState
              message="No facilities to report on yet"
              subMessage="Risk and deadline figures appear once your organization has facilities with assigned training."
              colSpan={5}
              asTableRow
            />
          )}
        </TableBody>
      </Table>
    </FacilityTableSection>
  );
}
