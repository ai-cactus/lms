import React from 'react';
import Link from 'next/link';
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
import type { PriorityRiskRow } from '@/app/actions/dashboard-facility';
import { RiskLevelChip } from './FacilityChips';
import { FacilityNameCell, FacilityTableSection, facilityTableHeadClass } from './table-parts';

/** Facilities surfaced before the row-count footer. */
const MAX_ROWS = 5;

interface PriorityRisksTableProps {
  /** Every accessible facility, already sorted most at risk first. */
  rows: PriorityRiskRow[];
}

export default function PriorityRisksTable({ rows }: PriorityRisksTableProps) {
  const topRows = rows.slice(0, MAX_ROWS);

  return (
    <FacilityTableSection
      title="Priority Risks & Deadlines by Facilities"
      description="Performance overview across all facilities"
      shown={topRows.length}
      total={rows.length}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(facilityTableHeadClass, 'rounded-l-[9px]')}>
              Facilities
            </TableHead>
            <TableHead className={facilityTableHeadClass}>Staff Count</TableHead>
            <TableHead className={cn(facilityTableHeadClass, 'hidden sm:table-cell')}>
              Active Learners
            </TableHead>
            <TableHead className={facilityTableHeadClass}>Overdue Trainings</TableHead>
            <TableHead className={cn(facilityTableHeadClass, 'hidden md:table-cell')}>
              Risk Level
            </TableHead>
            <TableHead className={cn(facilityTableHeadClass, 'rounded-r-[9px]')}>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {topRows.length > 0 ? (
            topRows.map((row) => (
              <TableRow key={row.facilityId} className="h-[68px]">
                <TableCell className="px-4 py-3">
                  <FacilityNameCell name={row.name} type={row.type} />
                </TableCell>
                <TableCell className="px-4 text-sm font-medium text-foreground">
                  {row.staffCount}
                </TableCell>
                <TableCell className="hidden px-4 text-sm font-medium text-foreground sm:table-cell">
                  {row.activeLearners}
                </TableCell>
                <TableCell
                  className={cn(
                    'px-4 text-sm font-semibold',
                    row.overdueTrainings > 0 ? 'text-error' : 'text-foreground',
                  )}
                >
                  {row.overdueTrainings}
                </TableCell>
                <TableCell className="hidden px-4 md:table-cell">
                  <RiskLevelChip level={row.riskLevel} />
                </TableCell>
                <TableCell className="px-4">
                  <Link
                    href={`/dashboard?facility=${row.facilityId}`}
                    className="text-sm font-semibold whitespace-nowrap text-primary hover:underline"
                  >
                    View facility dashboard
                    <span className="sr-only"> for {row.name}</span>
                  </Link>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <EmptyTableState
              message="No facilities to report on yet"
              subMessage="Risk and deadline figures appear once your organization has facilities with assigned training."
              colSpan={6}
              asTableRow
            />
          )}
        </TableBody>
      </Table>
    </FacilityTableSection>
  );
}
