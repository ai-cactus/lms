'use client';

import Image from 'next/image';
import { GraduationCap, UserPlus, CheckCircle2, Info, Download } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { AuditorOverviewStats, AuditorCourseRow } from '@/app/actions/auditor';
import { useExportJobs } from './ExportJobsProvider';

interface Props {
  stats: AuditorOverviewStats;
  courses: AuditorCourseRow[];
}

export default function AuditorOverviewTab({ stats, courses }: Props) {
  const { startExport } = useExportJobs();
  const handleExport = () => {
    startExport({ scope: 'org', label: 'Organization report' });
  };

  return (
    <div>
      {/* Stat Cards */}
      <div className="mb-7 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* All Courses */}
        <div className="relative rounded-xl border border-border bg-background px-6 py-5">
          <div className="mb-3 flex size-9 items-center justify-center text-text-secondary">
            <GraduationCap className="size-[22px]" />
          </div>
          <span
            className="absolute right-[18px] top-[18px] text-text-tertiary"
            title="Total published courses in your organization"
          >
            <Info className="size-3.5" />
          </span>
          <p className="mb-1.5 text-[13px] text-text-secondary">All Courses</p>
          <p className="text-3xl font-bold leading-none text-foreground">{stats.totalCourses}</p>
        </div>

        {/* Staff Assigned */}
        <div className="relative rounded-xl border border-border bg-background px-6 py-5">
          <div className="mb-3 flex size-9 items-center justify-center text-text-secondary">
            <UserPlus className="size-[22px]" />
          </div>
          <span
            className="absolute right-[18px] top-[18px] text-text-tertiary"
            title="Total active staff members in your organization"
          >
            <Info className="size-3.5" />
          </span>
          <p className="mb-1.5 text-[13px] text-text-secondary">Staff Assigned</p>
          <p className="text-3xl font-bold leading-none text-foreground">
            {stats.totalStaffAssigned.toLocaleString()}
          </p>
        </div>

        {/* Completion Rate */}
        <div className="relative rounded-xl border border-border bg-background px-6 py-5">
          <div className="mb-3 flex size-9 items-center justify-center text-text-secondary">
            <CheckCircle2 className="size-[22px]" />
          </div>
          <span
            className="absolute right-[18px] top-[18px] text-text-tertiary"
            title="Percentage of completed enrollments across all org courses"
          >
            <Info className="size-3.5" />
          </span>
          <p className="mb-1.5 text-[13px] text-text-secondary">Completion Rate</p>
          <p className="text-3xl font-bold leading-none text-foreground">{stats.completionRate}%</p>
        </div>
      </div>

      {/* Recent Assigned Courses Table */}
      <div className="rounded-xl border border-border bg-background p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-foreground">Recent Assigned Courses</h2>
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              title="Export organization activity (PDF)"
            >
              <Download className="size-3.5" />
              Export
            </Button>
          </div>
        </div>

        {courses.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-primary/10">
              <GraduationCap className="size-10 text-primary" aria-hidden="true" />
            </div>
            <p className="mb-1.5 text-base font-semibold text-foreground">No course yet.</p>
            <p className="text-sm text-text-tertiary">
              Courses will appear here once staff finish assigned courses.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-0">
                  <TableHead>Course Name</TableHead>
                  <TableHead>Assigned Staff</TableHead>
                  <TableHead>Completion Rate</TableHead>
                  <TableHead>Assigned Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courses.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#1e293b]">
                          {course.thumbnail ? (
                            <Image
                              src={course.thumbnail}
                              alt={course.title}
                              width={36}
                              height={36}
                              className="size-full object-cover"
                            />
                          ) : (
                            <GraduationCap className="size-[18px] text-text-tertiary" />
                          )}
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {course.title}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{course.assignedStaff}</TableCell>
                    <TableCell className="font-bold text-foreground">
                      {course.completionRate}%
                    </TableCell>
                    <TableCell className="text-[13px] text-text-secondary">
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
          </div>
        )}
      </div>
    </div>
  );
}
