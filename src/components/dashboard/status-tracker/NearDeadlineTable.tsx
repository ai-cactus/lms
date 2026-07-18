import React from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

/** Row shape with `dueAt` serialized to an ISO string for the client boundary. */
export interface NearDeadlineRowView {
  enrollmentId: string;
  userId: string;
  workerName: string;
  workerEmail: string;
  courseId: string;
  courseTitle: string;
  dueAt: string;
  daysUntilDue: number;
  status: string;
  managerName: string | null;
}

interface Props {
  rows: NearDeadlineRowView[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue <= 0) return 'Due today';
  return `${daysUntilDue} ${daysUntilDue === 1 ? 'day' : 'days'}`;
}

/**
 * Presentational "At Risk — Next 7 Days" table: enrollments whose deadline is
 * approaching but not yet passed. Receives already-serialized rows from the
 * server page; performs no data fetching or filtering.
 */
export default function NearDeadlineTable({ rows }: Props) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-foreground">At Risk — Next 7 Days</h2>
        <p className="text-sm text-text-tertiary">
          Training due within the next 7 days that has not been completed yet.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-primary/10">
            <CalendarClock className="size-10 text-primary" aria-hidden="true" />
          </div>
          <p className="mb-1.5 text-base font-semibold text-foreground">
            Nothing due in the next 7 days
          </p>
          <p className="text-sm text-text-tertiary">
            No worker has training approaching its deadline.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead>Worker</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead>Due in</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Manager</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.enrollmentId}>
                  <TableCell>
                    <Link
                      href={`/dashboard/staff/${row.userId}`}
                      className="flex items-center gap-2.5 group"
                    >
                      <div
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-bold text-primary"
                        aria-hidden
                      >
                        {row.workerName[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-foreground group-hover:text-primary group-hover:underline">
                          {row.workerName}
                        </div>
                        <div className="text-xs text-text-tertiary">{row.workerEmail}</div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-[13px] text-text-secondary">
                    {row.courseTitle}
                  </TableCell>
                  <TableCell className="text-[13px] text-text-secondary">
                    {formatDate(row.dueAt)}
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold text-foreground">
                      {dueLabel(row.daysUntilDue)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{statusLabel(row.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-[13px] text-text-secondary">
                    {row.managerName ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
