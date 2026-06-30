'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Row shape with `dueAt` serialized to an ISO string for the client boundary. */
export interface ComplianceRowView {
  enrollmentId: string;
  userId: string;
  workerName: string;
  workerEmail: string;
  courseId: string;
  courseTitle: string;
  dueAt: string;
  daysOverdue: number;
  status: string;
  managerName: string | null;
}

interface Props {
  rows: ComplianceRowView[];
  /** Days-overdue boundary at/above which a row is a hard escalation (red). */
  hardThresholdDays: number;
}

const ALL = '__all__';
const NO_MANAGER = '__none__';

const MIN_DAYS_OPTIONS = [0, 1, 3, 7, 14, 30] as const;

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

/**
 * Client-side filtering + responsive table for the admin compliance page. Data is
 * fetched server-side; this component only filters the already-loaded rows.
 */
export default function ComplianceTableClient({ rows, hardThresholdDays }: Props) {
  const [courseFilter, setCourseFilter] = useState<string>(ALL);
  const [managerFilter, setManagerFilter] = useState<string>(ALL);
  const [minDays, setMinDays] = useState<string>('0');

  // Distinct courses/managers for the filter dropdowns, derived from the rows.
  const courseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.courseId, r.courseTitle);
    return Array.from(map, ([courseId, courseTitle]) => ({ courseId, courseTitle })).sort((a, b) =>
      a.courseTitle.localeCompare(b.courseTitle),
    );
  }, [rows]);

  const managerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) if (r.managerName) names.add(r.managerName);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const min = Number(minDays);
    return rows.filter((r) => {
      if (courseFilter !== ALL && r.courseId !== courseFilter) return false;
      if (managerFilter === NO_MANAGER && r.managerName !== null) return false;
      if (managerFilter !== ALL && managerFilter !== NO_MANAGER && r.managerName !== managerFilter)
        return false;
      if (r.daysOverdue < min) return false;
      return true;
    });
  }, [rows, courseFilter, managerFilter, minDays]);

  return (
    <div className="rounded-xl border border-border bg-background p-4 sm:p-6">
      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-secondary">Course</label>
          <Select value={courseFilter} onValueChange={setCourseFilter}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="All courses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All courses</SelectItem>
              {courseOptions.map((c) => (
                <SelectItem key={c.courseId} value={c.courseId}>
                  {c.courseTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-secondary">Manager</label>
          <Select value={managerFilter} onValueChange={setManagerFilter}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="All managers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All managers</SelectItem>
              <SelectItem value={NO_MANAGER}>No manager</SelectItem>
              {managerOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-secondary">Min. days overdue</label>
          <Select value={minDays} onValueChange={setMinDays}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MIN_DAYS_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d === 0 ? 'Any' : `${d}+ days`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-success/10">
            <ShieldCheck className="size-10 text-success" aria-hidden="true" />
          </div>
          <p className="mb-1.5 text-base font-semibold text-foreground">
            No overdue training — your team is compliant
          </p>
          <p className="text-sm text-text-tertiary">
            {rows.length === 0
              ? 'No worker has training past its deadline.'
              : 'No overdue training matches your filters.'}
          </p>
        </div>
      ) : (
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead>Worker</TableHead>
              <TableHead>Course</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Days overdue</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Manager</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((row) => {
              const isHard = row.daysOverdue >= hardThresholdDays;
              return (
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
                    <span
                      className={isHard ? 'font-bold text-error' : 'font-semibold text-foreground'}
                    >
                      {row.daysOverdue} {row.daysOverdue === 1 ? 'day' : 'days'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={isHard ? 'destructive' : 'secondary'}>
                      {statusLabel(row.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[13px] text-text-secondary">
                    {row.managerName ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
