import React from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Row shape with `dueAt` serialized to an ISO string for the client boundary. */
export interface StatusTrackerOverviewRow {
  enrollmentId: string;
  workerName: string;
  courseTitle: string;
  dueAt: string;
  daysOverdue: number;
}

interface Props {
  overdueCount: number;
  hardEscalationCount: number;
  /** Days-overdue boundary at/above which a row is a hard escalation (red). */
  hardThresholdDays: number;
  /** Overdue rows, pre-sorted most-overdue first. Only the top few are shown. */
  rows: StatusTrackerOverviewRow[];
}

/** Number of rows surfaced in the compact overview list. */
const MAX_ROWS = 5;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Presentational Status Tracker overview for the admin dashboard. Shows overdue /
 * hard-escalation counts plus the {@link MAX_ROWS} most-overdue workers, with a
 * "View all" link to the full status-tracker page. Receives already-serialized
 * summary data from the server page; performs no data fetching.
 */
export default function StatusTrackerOverview({
  overdueCount,
  hardEscalationCount,
  hardThresholdDays,
  rows,
}: Props) {
  const topRows = rows.slice(0, MAX_ROWS);

  return (
    <section>
      {/* Section header */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-foreground">Status Tracker</h2>
        <Link
          href="/dashboard/status-tracker"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          View all
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {topRows.length === 0 ? (
        /* Empty state — slim card, section header stays visible. */
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/10">
            <ShieldCheck className="size-5 text-success" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              All caught up — no overdue training
            </p>
            <p className="text-sm text-text-tertiary">No worker has training past its deadline.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Summary chips */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-5">
              <p className="text-sm text-text-secondary">Overdue training</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{overdueCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-5">
              <p className="text-sm text-text-secondary">
                Hard escalations ({hardThresholdDays}+ days)
              </p>
              <p
                className={[
                  'mt-1 text-2xl font-bold',
                  hardEscalationCount > 0 ? 'text-error' : 'text-foreground',
                ].join(' ')}
              >
                {hardEscalationCount}
              </p>
            </div>
          </div>

          {/* Compact top-N list */}
          <div className="overflow-x-auto rounded-xl border border-border bg-background p-4 sm:p-6">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead>Worker</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Days overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topRows.map((row) => {
                  const isHard = row.daysOverdue >= hardThresholdDays;
                  return (
                    <TableRow key={row.enrollmentId}>
                      <TableCell className="text-sm font-semibold text-foreground">
                        {row.workerName}
                      </TableCell>
                      <TableCell className="text-[13px] text-text-secondary">
                        {row.courseTitle}
                      </TableCell>
                      <TableCell className="text-[13px] text-text-secondary">
                        {formatDate(row.dueAt)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            isHard ? 'font-bold text-error' : 'font-semibold text-foreground'
                          }
                        >
                          {row.daysOverdue} {row.daysOverdue === 1 ? 'day' : 'days'}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  );
}
