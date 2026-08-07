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
import type { FacilityOverviewRow } from '@/app/actions/dashboard-facility';
import { AuditReadinessChip, RiskLevelChip } from './FacilityChips';
import { FacilityNameCell, FacilityTableSection, facilityTableHeadClass } from './table-parts';

/** Facilities surfaced before the row-count footer. */
const MAX_ROWS = 5;

interface FacilitiesOverviewTableProps {
  rows: FacilityOverviewRow[];
}

export default function FacilitiesOverviewTable({ rows }: FacilitiesOverviewTableProps) {
  const topRows = rows.slice(0, MAX_ROWS);

  return (
    <FacilityTableSection
      title="Facilities Overview"
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
            <TableHead className={cn(facilityTableHeadClass, 'hidden sm:table-cell')}>
              Active Trainings
            </TableHead>
            <TableHead className={facilityTableHeadClass}>Training Completion</TableHead>
            <TableHead className={cn(facilityTableHeadClass, 'hidden md:table-cell')}>
              Overdue Trainings
            </TableHead>
            <TableHead className={facilityTableHeadClass}>Audit Readiness</TableHead>
            <TableHead className={cn(facilityTableHeadClass, 'hidden lg:table-cell')}>
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
                <TableCell className="hidden px-4 text-sm font-medium text-foreground sm:table-cell">
                  {row.activeTrainings}
                </TableCell>
                <TableCell className="px-4 text-sm font-semibold text-foreground">
                  {row.completionPercent}%
                </TableCell>
                <TableCell
                  className={cn(
                    'hidden px-4 text-sm font-semibold md:table-cell',
                    row.overdueTrainings > 0 ? 'text-error' : 'text-foreground',
                  )}
                >
                  {row.overdueTrainings}
                </TableCell>
                <TableCell className="px-4">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-sm font-semibold text-foreground">
                      {row.auditReadinessPercent}%
                    </span>
                    <AuditReadinessChip level={row.auditReadiness} />
                  </div>
                </TableCell>
                <TableCell className="hidden px-4 lg:table-cell">
                  <RiskLevelChip level={row.riskLevel} />
                </TableCell>
                <TableCell className="px-4">
                  <Link
                    href={`/dashboard?facility=${row.facilityId}`}
                    className="text-sm font-semibold whitespace-nowrap text-primary hover:underline"
                  >
                    View dashboard
                    <span className="sr-only"> for {row.name}</span>
                  </Link>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <EmptyTableState
              message="No facilities to report on yet"
              subMessage="Completion and audit readiness appear once your organization has facilities with assigned training."
              colSpan={7}
              asTableRow
            />
          )}
        </TableBody>
      </Table>
    </FacilityTableSection>
  );
}
