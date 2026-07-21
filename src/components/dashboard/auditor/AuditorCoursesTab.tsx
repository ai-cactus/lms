'use client';

import Image from 'next/image';
import { useState, useEffect, useTransition } from 'react';
import { Search, Download, GraduationCap } from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getAuditorCourses } from '@/app/actions/auditor';
import type { AuditorCourseRow } from '@/app/actions/auditor';
import { useExportJobs } from './ExportJobsProvider';
import { useAuditFilter, toRangeInput } from './AuditFilterProvider';

export default function AuditorCoursesTab() {
  const [courses, setCourses] = useState<AuditorCourseRow[]>([]);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const { range } = useAuditFilter();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        const data = await getAuditorCourses(search || undefined, toRangeInput(range));
        setCourses(data);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, range]);

  const { startExport } = useExportJobs();
  const handleExportAll = () => {
    startExport({ scope: 'all-courses', label: 'All courses report', ...toRangeInput(range) });
  };

  return (
    <div className="rounded-xl border border-border bg-background p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-foreground">All Courses</h2>
        <div className="flex items-center gap-2.5">
          <Input
            type="search"
            className="h-11 w-full sm:w-[220px]"
            placeholder="Search courses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search courses"
            startIcon={<Search aria-hidden="true" />}
          />
          <Button variant="outline" size="sm" onClick={handleExportAll} title="Export all (PDF)">
            <Download className="size-3.5" />
            Export all
          </Button>
        </div>
      </div>

      {isPending && courses.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-sm text-text-tertiary">Loading courses&hellip;</p>
        </div>
      ) : courses.length === 0 ? (
        <EmptyTableState
          message="No courses found."
          subMessage={
            search
              ? 'No courses match your search.'
              : 'No published courses in your organization yet.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent border-0">
                <TableHead>Course Name</TableHead>
                <TableHead>Assigned Staff</TableHead>
                <TableHead>Completion Rate</TableHead>
                <TableHead>Assigned Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
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
                      <span className="text-sm font-semibold text-foreground">{course.title}</span>
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
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() =>
                        startExport({
                          scope: 'course',
                          scopeId: course.id,
                          label: `Course: ${course.title}`,
                          ...toRangeInput(range),
                        })
                      }
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      Export
                    </button>
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
