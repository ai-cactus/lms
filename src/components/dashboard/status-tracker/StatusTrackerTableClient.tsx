'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * A single assignment shown in the status tracker. `dueAt` is serialized to an
 * ISO string for the client boundary. Exactly one of `daysOverdue` /
 * `daysUntilDue` is set: overdue rows carry the former, at-risk rows the latter.
 */
export interface StatusTrackerRowView {
  enrollmentId: string;
  userId: string;
  workerName: string;
  workerEmail: string;
  courseId: string;
  courseTitle: string;
  /** Facility stamped on the enrollment at assignment time; null when none. */
  facilityName: string | null;
  dueAt: string;
  daysOverdue: number | null;
  daysUntilDue: number | null;
}

interface Props {
  rows: StatusTrackerRowView[];
}

export const tableHeadClass =
  'h-[41px] truncate bg-[#f8f9fb] text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] sm:text-[15.5px]';

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function overdueLabel(daysOverdue: number): string {
  if (daysOverdue <= 0) return 'Overdue today';
  return `Overdue by ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'}`;
}

function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue <= 0) return 'Due today';
  return `Due in ${daysUntilDue} ${daysUntilDue === 1 ? 'day' : 'days'}`;
}

export function DeadlineBadge({ row }: { row: StatusTrackerRowView }) {
  const isOverdue = row.daysOverdue !== null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[7px] rounded-full px-[10px] py-1.5 text-[13px] font-semibold whitespace-nowrap sm:px-[14px] sm:text-[14.4px]',
        isOverdue ? 'bg-[#fee4e2] text-[#b42318]' : 'bg-[#fef0c7] text-[#b54708]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-[7px] shrink-0 rounded-full',
          isOverdue ? 'bg-[#d92d20]' : 'bg-[#f79009]',
        )}
      />
      {isOverdue ? overdueLabel(row.daysOverdue as number) : dueLabel(row.daysUntilDue ?? 0)}
    </span>
  );
}

/**
 * Status-tracker assignment table: every overdue or soon-due assignment in the
 * organization, paginated client-side. Data is fetched and ordered server-side;
 * this component only slices the already-loaded rows into pages.
 */
export default function StatusTrackerTableClient({ rows }: Props) {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const totalEntries = rows.length;
  const totalPages = Math.ceil(totalEntries / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const pagedRows = rows.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) setCurrentPage(page);
    },
    [totalPages],
  );

  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (currentPage <= 3) return [1, 2, 3, '…', totalPages];
    if (currentPage >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages];
    return [1, '…', currentPage, '…', totalPages];
  }, [totalPages, currentPage]);

  return (
    <div className="flex flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] sm:px-[21px] sm:pt-[21px] sm:pb-4">
      <p className="text-[14px] leading-normal text-[#667085]">
        Assignments due within 7 days or already overdue.
      </p>

      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead
              className={cn(
                tableHeadClass,
                'rounded-l-[9px] rounded-r-[9px] px-2 sm:rounded-r-none sm:px-[18px]',
              )}
            >
              Staff Name
            </TableHead>
            <TableHead
              className={cn(tableHeadClass, 'hidden px-[18px] xl:table-cell xl:w-[271px]')}
            >
              Course
            </TableHead>
            <TableHead
              className={cn(tableHeadClass, 'hidden px-[18px] xl:table-cell xl:w-[151px]')}
            >
              Deadline
            </TableHead>
            <TableHead
              className={cn(tableHeadClass, 'hidden px-[18px] xl:table-cell xl:w-[180px]')}
            >
              Facility
            </TableHead>
            <TableHead
              className={cn(
                tableHeadClass,
                'hidden px-[18px] sm:table-cell sm:w-[190px] sm:rounded-r-[9px] xl:w-[211px]',
              )}
            >
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedRows.length > 0 ? (
            pagedRows.map((row) => (
              <TableRow
                key={row.enrollmentId}
                onClick={() => router.push(`/dashboard/staff/${row.userId}`)}
                className="h-[71px] cursor-pointer"
              >
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

                <TableCell className="hidden px-[18px] py-0 xl:table-cell">
                  <span
                    className="block truncate text-[15.5px] font-medium text-[#0d0d12]"
                    title={row.facilityName ?? undefined}
                  >
                    {row.facilityName ?? '—'}
                  </span>
                </TableCell>

                <TableCell className="hidden px-[18px] py-3 sm:table-cell">
                  <DeadlineBadge row={row} />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <EmptyTableState
              message="No overdue or upcoming training"
              subMessage="No worker has training past its deadline or coming due in the next 7 days."
              colSpan={5}
              asTableRow
            />
          )}
        </TableBody>
      </Table>

      {totalEntries > 0 && (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
          <span className="text-xs font-medium tracking-[-0.36px] text-[#9a9a9a]">
            Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalEntries)} of{' '}
            {totalEntries} entries
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>

            {pageNumbers.map((n, i) =>
              n === '…' ? (
                <span
                  key={`ellipsis-${i}`}
                  className="flex size-10 items-center justify-center text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]"
                >
                  …
                </span>
              ) : (
                <Button
                  key={n}
                  variant={n === currentPage ? 'default' : 'ghost'}
                  size="icon-sm"
                  className="size-10 rounded-[8px] text-xs font-medium tracking-[-0.36px] data-[variant=ghost]:text-[#1c1c1c]"
                  onClick={() => handlePageChange(n as number)}
                  aria-current={n === currentPage ? 'page' : undefined}
                >
                  {n}
                </Button>
              ),
            )}

            <Button
              variant="outline"
              size="icon-sm"
              className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages || totalPages === 0}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-3 text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]">
            Show
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(v) => {
                setItemsPerPage(Number(v));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger
                className="h-10 w-[66px] rounded-[8px] border-[#d9d9d9] px-3 text-xs"
                aria-label="Entries per page"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
            entries
          </div>
        </div>
      )}
    </div>
  );
}
