'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, useTransition } from 'react';
import { GraduationCap, UserPlus, CheckCircle2, Info, Download } from 'lucide-react';
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
  getAuditorOverviewStats,
  getAuditorCourses,
  type AuditorOverviewStats,
  type AuditorCourseRow,
} from '@/app/actions/auditor';
import { useExportJobs } from './ExportJobsProvider';
import { useAuditFilter, toRangeInput } from './AuditFilterProvider';
import {
  auditCard,
  auditCardHeader,
  auditCardTitle,
  auditCell,
  auditHead,
  auditHeaderGroup,
  auditOutlineButton,
  auditRow,
} from './audit-ui';
import { cn } from '@/lib/utils';

interface Props {
  stats: AuditorOverviewStats;
  courses: AuditorCourseRow[];
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}

function StatCard({ icon, label, value, hint }: StatCardProps) {
  return (
    <div className="relative rounded-[12px] border border-[#e2e8f0] bg-white p-4 sm:p-6">
      <div className="flex size-9 items-center justify-center rounded-[8px] bg-[#f8fafc] text-[#475569] [&_svg]:size-5">
        {icon}
      </div>
      <span className="absolute right-4 top-4 text-[#cbd5e1] sm:right-6 sm:top-6" title={hint}>
        <Info className="size-3" />
      </span>
      <p className="mt-5 text-[14px] font-medium leading-5 text-[#64748b]">{label}</p>
      <p className="mt-1.5 text-[26px] font-bold leading-[1.2] text-[#0f172a] sm:text-[28px]">
        {value}
      </p>
    </div>
  );
}

export default function AuditorOverviewTab({
  stats: initialStats,
  courses: initialCourses,
}: Props) {
  const { startExport } = useExportJobs();
  const { range } = useAuditFilter();
  const [stats, setStats] = useState<AuditorOverviewStats>(initialStats);
  const [courses, setCourses] = useState<AuditorCourseRow[]>(initialCourses);
  const [, startTransition] = useTransition();
  // The server-provided props already reflect the empty ("all time") range, so
  // skip the first fetch and only refetch when the range actually changes.
  const didMount = useRef(false);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    startTransition(async () => {
      const rangeInput = toRangeInput(range);
      const [nextStats, nextCourses] = await Promise.all([
        getAuditorOverviewStats(rangeInput),
        getAuditorCourses(undefined, rangeInput),
      ]);
      setStats(nextStats);
      setCourses(nextCourses);
    });
  }, [range]);

  const handleExport = () => {
    startExport({ scope: 'org', label: 'Organization report', ...toRangeInput(range) });
  };

  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        <StatCard
          icon={<GraduationCap />}
          label="All Courses"
          value={String(stats.totalCourses)}
          hint="Total published courses in your organization"
        />
        <StatCard
          icon={<UserPlus />}
          label="Staff Assigned"
          value={stats.totalStaffAssigned.toLocaleString()}
          hint="Total active staff members in your organization"
        />
        <StatCard
          icon={<CheckCircle2 />}
          label="Completion Rate"
          value={`${stats.completionRate}%`}
          hint="Percentage of completed enrollments across all org courses"
        />
      </div>

      <div className={auditCard}>
        <div className={auditCardHeader}>
          <h2 className={auditCardTitle}>Recent Assigned Courses</h2>
          <Button
            variant="outline"
            className={cn(auditOutlineButton, 'self-start sm:self-auto')}
            onClick={handleExport}
            title="Export organization activity (PDF)"
          >
            <Download className="size-3.5" />
            Export
          </Button>
        </div>

        {courses.length === 0 ? (
          <EmptyTableState
            message="No course yet."
            subMessage="Courses will appear here once staff finish assigned courses."
          />
        ) : (
          <Table>
            <TableHeader className={auditHeaderGroup}>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead className={cn(auditHead, 'w-full sm:w-[360px]')}>Course Name</TableHead>
                <TableHead className={cn(auditHead, 'hidden sm:table-cell sm:w-[240px]')}>
                  Assigned Staff
                </TableHead>
                <TableHead className={cn(auditHead, 'hidden md:table-cell md:w-[170px]')}>
                  Completion Rate
                </TableHead>
                <TableHead className={cn(auditHead, 'hidden lg:table-cell')}>
                  Assigned Date
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((course) => (
                <TableRow key={course.id} className={auditRow}>
                  <TableCell className={auditCell}>
                    <div className="flex items-center gap-[18px]">
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#1e293b]">
                        {course.thumbnail ? (
                          <Image
                            src={course.thumbnail}
                            alt={course.title}
                            width={40}
                            height={40}
                            className="size-full object-cover"
                          />
                        ) : (
                          <GraduationCap className="size-5 text-white/70" />
                        )}
                      </div>
                      <span className="truncate text-[15.5px] font-medium tracking-[0.31px] text-[#1e1e1e]">
                        {course.title}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden sm:table-cell')}>
                    {course.assignedStaff}
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden font-semibold md:table-cell')}>
                    {course.completionRate}%
                  </TableCell>
                  <TableCell
                    className={cn(
                      auditCell,
                      'hidden whitespace-nowrap text-[#64748b] lg:table-cell',
                    )}
                  >
                    {course.assignedDate.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
