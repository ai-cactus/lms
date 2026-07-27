'use client';

import React from 'react';
import Link from 'next/link';
import { SquareArrowOutUpRight } from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
// The full-page table is the canonical implementation of this chrome; the
// widget reuses its row shape, badge, and header styling so they can't drift.
import {
  tableHeadClass,
  DeadlineBadge,
  formatDate,
  type StatusTrackerRowView,
} from './StatusTrackerTableClient';

interface Props {
  /** Merged overdue + due-soon rows, pre-sorted by the server. */
  rows: StatusTrackerRowView[];
}

/** Number of rows surfaced in the compact overview widget. */
const MAX_ROWS = 5;

/**
 * Presentational Status Tracker widget for the admin dashboard home. Shows the
 * most urgent assignments in the same card/table chrome as the Status Tracker
 * page, with a "View all" button linking to it. Receives already-serialized
 * rows from the server page; performs no data fetching.
 */
export default function StatusTrackerOverview({ rows }: Props) {
  const topRows = rows.slice(0, MAX_ROWS);

  return (
    <section className="flex flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] sm:px-[21px] sm:pt-[21px] sm:pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-base leading-[1.5] font-semibold tracking-[0.4px] text-[#0d0d12] md:text-xl">
            Status Tracker
          </h3>
          <p className="text-[14px] leading-normal text-[#667085]">
            Assignments due within 7 days or already overdue.
          </p>
        </div>
        {rows.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-[7px] rounded-full bg-[#fee4e2] px-[14px] py-1.5 text-[13px] font-semibold whitespace-nowrap text-[#b42318] sm:text-[14.4px]">
            <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-[#d92d20]" />
            {rows.length} at risk
          </span>
        )}
      </div>

      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(tableHeadClass, 'rounded-l-[9px] px-2 sm:px-[18px]')}>
              Staff Name
            </TableHead>
            <TableHead
              className={cn(tableHeadClass, 'hidden px-[18px] xl:table-cell xl:w-[271px]')}
            >
              Course
            </TableHead>
            <TableHead
              className={cn(tableHeadClass, 'hidden px-[18px] xl:table-cell xl:w-[191px]')}
            >
              Deadline
            </TableHead>
            <TableHead
              className={cn(
                tableHeadClass,
                'hidden px-[18px] sm:table-cell sm:w-[190px] xl:w-[211px]',
              )}
            >
              Status
            </TableHead>
            <TableHead
              className={cn(
                tableHeadClass,
                'w-[58px] rounded-r-[9px] px-1 text-center sm:w-[92px] sm:px-2 xl:w-[78px]',
              )}
            >
              Action
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {topRows.length > 0 ? (
            topRows.map((row) => (
              <TableRow key={row.enrollmentId} className="h-[71px]">
                <TableCell className="px-2 py-3 sm:px-[18px]">
                  <div className="flex items-center gap-2.5 sm:gap-[18px]">
                    <span
                      aria-hidden="true"
                      className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-[15px] font-semibold text-[#666d80]"
                    >
                      {(row.workerName.charAt(0) || row.workerEmail.charAt(0)).toUpperCase()}
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-[14px] font-semibold tracking-[0.31px] text-[#0d0d12] sm:text-[15.5px]">
                        {row.workerName}
                      </span>
                      <span className="truncate text-[12px] font-normal tracking-[0.27px] text-[#666d80] sm:text-[13.5px]">
                        <span className="xl:hidden">
                          {row.courseTitle} · {formatDate(row.dueAt)}
                        </span>
                        <span className="hidden xl:inline">{row.workerEmail}</span>
                      </span>
                      {/* The Status column is dropped below sm, so the badge moves inline. */}
                      <span className="sm:hidden">
                        <DeadlineBadge row={row} />
                      </span>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="hidden truncate px-5 py-0 text-[17.5px] font-medium text-[#0d0d12] xl:table-cell">
                  {row.courseTitle}
                </TableCell>

                <TableCell className="hidden px-5 py-0 text-[17.5px] font-normal whitespace-nowrap text-[#667085] xl:table-cell">
                  {formatDate(row.dueAt)}
                </TableCell>

                <TableCell className="hidden px-[18px] py-3 sm:table-cell">
                  <DeadlineBadge row={row} />
                </TableCell>

                <TableCell className="px-1 py-0 text-center sm:px-2">
                  <Link
                    href={`/dashboard/staff/${row.userId}`}
                    className="inline-flex items-center justify-center rounded-[8px] px-1 py-2.5 text-[14px] font-semibold text-primary hover:underline sm:px-4 sm:text-[15px]"
                  >
                    View
                    <span className="sr-only"> {row.workerName}</span>
                  </Link>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <EmptyTableState
              message="All caught up — no overdue training"
              subMessage="No worker has training past its deadline or coming due in the next 7 days."
              colSpan={5}
              asTableRow
            />
          )}
        </TableBody>
      </Table>

      {topRows.length > 0 && (
        <div className="flex justify-end">
          <Button
            asChild
            variant="outline"
            className="h-10 gap-2 rounded-[8px] border-[#d9d9d9] bg-white px-4 text-[14px] font-semibold text-[#0d0d12]"
          >
            <Link href="/dashboard/status-tracker">
              View all
              <SquareArrowOutUpRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}
