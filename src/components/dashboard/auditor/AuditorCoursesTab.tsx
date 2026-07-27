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
import {
  auditCard,
  auditCardHeader,
  auditCardTitle,
  auditCell,
  auditHead,
  auditHeaderGroup,
  auditOutlineButton,
  auditRow,
  auditRowAction,
  auditSearch,
  auditSearchWrap,
} from './audit-ui';
import { cn } from '@/lib/utils';

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
    <div className={auditCard}>
      <div className={auditCardHeader}>
        <h2 className={auditCardTitle}>All Courses</h2>
        <div className="flex items-center gap-3">
          <div className={auditSearchWrap}>
            <Input
              type="search"
              className={auditSearch}
              placeholder="Search courses…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search courses"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>
          <Button
            variant="outline"
            className={auditOutlineButton}
            onClick={handleExportAll}
            title="Export all (PDF)"
          >
            <Download className="size-3.5" />
            Export all
          </Button>
        </div>
      </div>

      {isPending && courses.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[14px] text-[#64748b]">Loading courses&hellip;</p>
        </div>
      ) : courses.length === 0 ? (
        <EmptyTableState
          message={search ? 'No Results' : 'No courses found.'}
          subMessage={
            search
              ? `No results matching ‘${search}’`
              : 'No published courses in your organization yet.'
          }
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
              <TableHead className={cn(auditHead, 'hidden lg:table-cell lg:w-[163px]')}>
                Assigned Date
              </TableHead>
              <TableHead className={auditHead}>Action</TableHead>
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
                  className={cn(auditCell, 'hidden whitespace-nowrap text-[#64748b] lg:table-cell')}
                >
                  {course.assignedDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell className={auditCell}>
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
                    className={auditRowAction}
                  >
                    Export
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
