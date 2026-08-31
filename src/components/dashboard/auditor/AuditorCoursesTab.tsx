'use client';

import Image from 'next/image';
import { useState, useEffect, useMemo, useTransition } from 'react';
import { Search, Upload, GraduationCap } from 'lucide-react';
import AuditEmptyState from './AuditEmptyState';
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
import AuditExportRangeModal, { type AuditExportRange } from './AuditExportRangeModal';
import AuditTablePagination, { AUDIT_DEFAULT_PAGE_SIZE } from './AuditTablePagination';
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
  auditStatusPill,
} from './audit-ui';
import { cn } from '@/lib/utils';

interface AuditorCoursesTabProps {
  /** Population an "Export all" covers — every course in the org, any status. */
  totalCourses: number;
}

interface PendingExport {
  scopeId?: string;
  label: string;
  count: number;
}

export default function AuditorCoursesTab({ totalCourses }: AuditorCoursesTabProps) {
  const [courses, setCourses] = useState<AuditorCourseRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(AUDIT_DEFAULT_PAGE_SIZE);
  const [pending, setPending] = useState<PendingExport | null>(null);
  const [isPending, startTransition] = useTransition();
  const { activeJob, startExport } = useExportJobs();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        const data = await getAuditorCourses(search || undefined);
        setCourses(data);
        setPage(1);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const visible = useMemo(
    () => courses.slice((page - 1) * pageSize, page * pageSize),
    [courses, page, pageSize],
  );

  const handleGenerate = (range: AuditExportRange) => {
    if (!pending) return;
    startExport({
      scope: pending.scopeId ? 'course' : 'all-courses',
      scopeId: pending.scopeId,
      label: pending.label,
      entity: 'course',
      count: pending.count,
      ...range,
    });
    setPending(null);
  };

  return (
    <div className={auditCard}>
      <div className={auditCardHeader}>
        <h2 className={auditCardTitle}>All Courses</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className={auditSearchWrap}>
            <Input
              type="search"
              className={auditSearch}
              placeholder="Search courses..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search courses"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>
          <Button
            variant="outline"
            className={cn(auditOutlineButton, 'shrink-0 text-primary')}
            disabled={Boolean(activeJob)}
            onClick={() => setPending({ label: 'All courses report', count: totalCourses })}
          >
            <Upload className="size-3.5" />
            Export all
          </Button>
        </div>
      </div>

      {isPending && courses.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[14px] text-[#64748b]">Loading courses&hellip;</p>
        </div>
      ) : courses.length === 0 ? (
        <AuditEmptyState
          message={search ? 'No Results' : 'No course yet.'}
          subMessage={
            search
              ? `No results matching ‘${search}’`
              : 'Courses will appear here once staff finish assigned courses.'
          }
        />
      ) : (
        <>
          {/* table-fixed keeps the long course titles from setting a min-content
              width that scrolls the table sideways: every other column is sized
              explicitly and the flexible Course Name column absorbs the rest,
              truncating instead of pushing. */}
          <Table className="table-fixed">
            <TableHeader className={auditHeaderGroup}>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead className={auditHead}>Course Name</TableHead>
                <TableHead className={cn(auditHead, 'hidden @md:table-cell @md:w-[140px]')}>
                  Assigned Staff
                </TableHead>
                <TableHead className={cn(auditHead, 'hidden @xl:table-cell @xl:w-[140px]')}>
                  Completion Rate
                </TableHead>
                <TableHead className={cn(auditHead, 'hidden @2xl:table-cell @2xl:w-[120px]')}>
                  Status
                </TableHead>
                <TableHead className={cn(auditHead, 'hidden @3xl:table-cell @3xl:w-[170px]')}>
                  Assigned Date
                </TableHead>
                <TableHead className={cn(auditHead, 'w-[92px] @md:w-[110px]')}>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((course) => (
                <TableRow key={course.id} className={auditRow}>
                  <TableCell className={auditCell}>
                    {/* min-w-0: a flex item will not shrink below its content
                        width, so without it the title never ellipsizes. */}
                    <div className="flex min-w-0 items-center gap-[18px]">
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#1e293b]">
                        {course.thumbnail ? (
                          <Image
                            src={course.thumbnail}
                            alt=""
                            width={40}
                            height={40}
                            className="size-full object-cover"
                          />
                        ) : (
                          <GraduationCap className="size-5 text-white/70" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div
                          className="truncate text-[15.5px] font-medium tracking-[0.31px] text-[#1e1e1e]"
                          title={course.title}
                        >
                          {course.title}
                        </div>
                        {/* The Status column is dropped below @2xl, so the pill
                            moves inline rather than disappearing. */}
                        <span className={cn(auditStatusPill(course.status), 'mt-1 @2xl:hidden')}>
                          {course.status}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden @md:table-cell')}>
                    {course.assignedStaff}
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden font-semibold @xl:table-cell')}>
                    {course.completionRate}%
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden @2xl:table-cell')}>
                    <span className={auditStatusPill(course.status)}>{course.status}</span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      auditCell,
                      'hidden whitespace-nowrap text-[#64748b] @3xl:table-cell',
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
                  <TableCell className={auditCell}>
                    <button
                      type="button"
                      disabled={Boolean(activeJob)}
                      onClick={() =>
                        setPending({
                          scopeId: course.id,
                          label: `Course: ${course.title}`,
                          count: 1,
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

          <AuditTablePagination
            page={page}
            pageSize={pageSize}
            totalEntries={courses.length}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
            label="Courses per page"
          />
        </>
      )}

      <AuditExportRangeModal
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onGenerate={handleGenerate}
      />
    </div>
  );
}
