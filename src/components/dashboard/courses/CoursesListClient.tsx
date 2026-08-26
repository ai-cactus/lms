'use client';

import React, { useState, useMemo, useEffect, useCallback, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RowActionsMenu, type RowAction } from '@/components/ui';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert } from '@/components/ui/alert';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CourseWithStats } from '@/types/course';
import { checkCourseGenerationJobV46 } from '@/app/actions/course-ai-v4.6';
import { clearPendingGeneration, readPendingGeneration } from '@/lib/course/pending-generation';
import { deleteCourse, updateCourse } from '@/app/actions/course';
import BillingGateModal from '@/components/dashboard/billing/BillingGateModal';
import AssignCourseModal from './AssignCourseModal';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  UserPlus,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

type BannerState = 'generating' | 'done' | 'failed' | 'unknown' | 'hidden';

const bannerClasses: Record<Exclude<BannerState, 'hidden'>, string> = {
  generating: 'border-primary/30 bg-primary/5 text-foreground',
  done: 'border-success/30 bg-success/10 text-foreground',
  failed: 'border-error/30 bg-error/10 text-foreground',
  unknown: 'border-warning/30 bg-warning/10 text-foreground',
};

// One or two undetermined polls are a blip (a deploy, a momentary network drop,
// a transient DB error) and polling should ride them out. Beyond that the
// banner would keep asserting work is in progress that we can no longer see, so
// we stop and say so.
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

const headCls =
  'h-10 px-2 text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] md:px-[18px] md:text-[15.5px]';
const cellCls = 'h-[71px] px-5 text-[17.5px] font-medium tracking-[0.35px] text-[#0d0d12]';

function PendingGenerationBanner() {
  const [banner, setBanner] = useState<BannerState>('hidden');

  const dismiss = useCallback(() => {
    clearPendingGeneration();
    setBanner('hidden');
  }, []);

  useEffect(() => {
    // Discards anything unresumable — unparseable, stale, or written by the
    // pre-module single-job payload shape.
    const pending = readPendingGeneration();
    if (!pending) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: initialising banner state from localStorage inside effect
    setBanner('generating');

    const jobIds = pending.jobs.map((job) => job.jobId);
    let consecutiveFailures = 0;

    // A multi-module generation is only done when every module's job is done,
    // and any failed module makes the whole run unusable for review.
    const interval = setInterval(async () => {
      // A thrown poll and an `{ error }` response assert the same thing — we
      // could not determine the state — so they share one give-up path.
      let failure: { err: unknown } | { pollErrors: string[] } | null = null;

      try {
        const results = await Promise.all(
          pending.jobs.map((job) => checkCourseGenerationJobV46(job.jobId)),
        );

        // Only `status: 'failed'` is the server reporting that the job failed.
        // An `{ error }` return — including 'Job not found', which can be
        // replication lag or a stale id from localStorage — means the status
        // is undetermined, and must never condemn a run that is still healthy.
        if (results.some((res) => res.status === 'failed')) {
          clearInterval(interval);
          setBanner('failed');
          return;
        }

        const pollErrors = results
          .map((res) => res.error)
          .filter((error): error is string => Boolean(error));

        if (pollErrors.length > 0) {
          failure = { pollErrors };
        } else {
          // Only an unbroken run of failures is evidence we've lost the jobs.
          consecutiveFailures = 0;
          if (results.every((res) => res.status === 'completed')) {
            clearInterval(interval);
            setBanner('done');
          }
          return;
        }
      } catch (err) {
        failure = { err };
      }

      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        clearInterval(interval);
        setBanner('unknown');
        logger.error({
          msg: '[course] Gave up polling course generation status',
          ...failure,
          jobIds,
          consecutiveFailures,
        });
      } else {
        logger.warn({
          msg: '[course] Course generation poll failed — retrying',
          ...failure,
          jobIds,
          consecutiveFailures,
        });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  if (banner === 'hidden') return null;

  return (
    <div
      className={cn(
        'mb-4 flex items-center gap-3 rounded-[10px] border px-4 py-3 text-sm',
        bannerClasses[banner],
      )}
    >
      {banner === 'generating' && (
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
      )}
      {banner === 'done' && (
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
      )}
      {banner === 'failed' && (
        <AlertTriangle className="size-4 shrink-0 text-error" aria-hidden="true" />
      )}
      {banner === 'unknown' && (
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
      )}
      <span className="flex-1">
        {banner === 'generating' && 'Your course is still being generated in the background…'}
        {banner === 'done' &&
          'Course generation complete! Resume the wizard to review and publish.'}
        {banner === 'failed' && 'Course generation failed. Please start a new course.'}
        {/* Deliberately not the `failed` copy: we lost contact with the jobs, we
            did not observe them fail, and telling the admin to start over could
            discard a run that actually completed. */}
        {banner === 'unknown' &&
          'We couldn’t check on your course generation. It may still be running.'}
      </span>
      {banner === 'done' && (
        <Link
          href="/dashboard/courses/create"
          className="font-semibold whitespace-nowrap text-success no-underline"
        >
          Resume Setup →
        </Link>
      )}
      {banner === 'unknown' && (
        <Link
          href="/dashboard/courses/queue"
          className="font-semibold whitespace-nowrap text-warning no-underline"
        >
          Check Job Queue →
        </Link>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="cursor-pointer border-none bg-none p-1 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rename modal for courses
// ---------------------------------------------------------------------------
function CourseRenameModal({
  courseId,
  currentTitle,
  onClose,
  onRenamed,
}: {
  courseId: string;
  currentTitle: string;
  onClose: () => void;
  onRenamed: (newTitle: string) => void;
}) {
  const [title, setTitle] = useState(currentTitle);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Course title cannot be empty.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateCourse(courseId, { title: trimmed });
        onRenamed(trimmed);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to rename course.');
      }
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Course</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Input
              className="h-11"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              disabled={isPending}
              aria-label="New course title"
            />
            {error && <Alert variant="error">{error}</Alert>}
          </div>

          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface CoursesListClientProps {
  courses: CourseWithStats[];
  /** Whether the organization has an active or trialing billing subscription. */
  hasBilling: boolean;
  /** Viewer's role — every row affordance is rendered from its registry gates. */
  viewerRole: Role;
}

/** Design maps the platform's two course types onto Video / Reading Course tabs. */
type CourseTypeTab = 'video' | 'slides';

const COURSE_TYPE_BY_TAB: Record<CourseTypeTab, string> = {
  video: 'video',
  slides: 'text',
};

const TAB_TRIGGER_CLASS =
  '-mb-px flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0.5 pb-2.5 text-sm font-medium text-[#818898] shadow-none after:hidden hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-none';

const TAB_COUNT_CLASS =
  'rounded-full bg-[#f0f2f5] px-1.5 py-0.5 text-xs leading-none font-medium text-[#666d80]';

/**
 * Build a compact pagination range with ellipses, e.g. [1, 2, 3, '…', 9].
 * Always shows the first and last page plus a window around the current page.
 */
function buildPaginationRange(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');

  pages.push(total);
  return pages;
}

export default function CoursesListClient({
  courses,
  hasBilling,
  viewerRole,
}: CoursesListClientProps) {
  const router = useRouter();
  const [courseList, setCourseList] = useState<CourseWithStats[]>(courses);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showBillingGate, setShowBillingGate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseWithStats | null>(null);
  const [courseToRename, setCourseToRename] = useState<{ id: string; title: string } | null>(null);
  const [courseToAssign, setCourseToAssign] = useState<{ id: string; title: string } | null>(null);
  const [, startTransition] = useTransition();

  // Every row affordance is derived from the registry, never from a role list —
  // read-only roles (e.g. supervisor) end up with no write items at all.
  const viewerRoleKey = dbRoleToRoleKey(viewerRole);
  const canAssign = can(viewerRoleKey, 'assignment.create');
  const canReadDocuments = can(viewerRoleKey, 'document.read');
  const canCreateCourse = can(viewerRoleKey, 'course.create');
  const canEditCourse = can(viewerRoleKey, 'course.edit');
  const canDeleteCourse = can(viewerRoleKey, 'course.delete');

  // Landing on an empty tab reads as "no courses", so open on the type the org
  // actually has, preferring Video when both (or neither) are populated.
  const [activeTab, setActiveTab] = useState<CourseTypeTab>(() =>
    courses.some((course) => course.type === COURSE_TYPE_BY_TAB.video) ||
    !courses.some((course) => course.type === COURSE_TYPE_BY_TAB.slides)
      ? 'video'
      : 'slides',
  );

  // Sync when server props change after revalidatePath
  useEffect(() => {
    setCourseList(courses);
  }, [courses]);

  const handleDelete = useCallback(
    (course: CourseWithStats) => {
      setDeletingId(course.id);
      setActionError(null);
      startTransition(async () => {
        try {
          await deleteCourse(course.id);
          setCourseList((prev) => prev.filter((c) => c.id !== course.id));
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Failed to delete course.');
        }
        setDeletingId(null);
      });
    },
    [startTransition],
  );

  const handleRenamed = useCallback((courseId: string, newTitle: string) => {
    setCourseList((prev) => prev.map((c) => (c.id === courseId ? { ...c, title: newTitle } : c)));
  }, []);

  const startCreateCourse = useCallback(() => {
    if (!hasBilling) {
      setShowBillingGate(true);
      return;
    }
    router.push('/dashboard/courses/create');
  }, [hasBilling, router]);

  const startPrebuiltCatalog = useCallback(() => {
    if (!hasBilling) {
      setShowBillingGate(true);
      return;
    }
    router.push('/dashboard/courses/prebuilt');
  }, [hasBilling, router]);

  const tabCounts = useMemo(
    () => ({
      video: courseList.filter((course) => course.type === COURSE_TYPE_BY_TAB.video).length,
      slides: courseList.filter((course) => course.type === COURSE_TYPE_BY_TAB.slides).length,
    }),
    [courseList],
  );

  // Search narrows within the active tab, never across it.
  const filteredCourses = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return courseList.filter(
      (course) =>
        course.type === COURSE_TYPE_BY_TAB[activeTab] && course.title.toLowerCase().includes(query),
    );
  }, [courseList, searchQuery, activeTab]);

  const totalPages = Math.ceil(filteredCourses.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentCourses = filteredCourses.slice(startIndex, startIndex + itemsPerPage);
  const totalEntries = filteredCourses.length;

  // The zero-courses state replaces the whole widget with the "No courses yet"
  // panel; an empty *search* result still renders the table chrome.
  const hasCourses = courseList.length > 0;

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const buildRowActions = (course: CourseWithStats): RowAction[] => {
    const actions: RowAction[] = [];

    if (canAssign) {
      actions.push({
        label: 'Assign to staff',
        icon: <UserPlus className="size-4" />,
        onSelect: () => setCourseToAssign({ id: course.id, title: course.title }),
      });
    }

    // Always listed per the design; forked courses (duplicates, adopted
    // prebuilts) carry no CourseVersion, so the item is disabled rather than
    // hidden when there is no source document to open.
    if (canReadDocuments) {
      actions.push({
        label: 'View Source Document',
        icon: <FileText className="size-4" />,
        disabled: !course.sourceDocumentId,
        onSelect: () => {
          if (course.sourceDocumentId) {
            router.push(`/dashboard/documents/${course.sourceDocumentId}`);
          }
        },
      });
    }

    if (canEditCourse) {
      actions.push({
        label: 'Rename',
        icon: <Pencil className="size-4" />,
        separatorBefore: actions.length > 0,
        onSelect: () => setCourseToRename({ id: course.id, title: course.title }),
      });
    }

    if (canDeleteCourse) {
      actions.push({
        label: deletingId === course.id ? 'Deleting…' : 'Delete',
        icon: <Trash2 className="size-4" />,
        variant: 'destructive',
        separatorBefore: !canEditCourse && actions.length > 0,
        disabled: deletingId === course.id,
        onSelect: () => setDeleteTarget(course),
      });
    }

    return actions;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      {courseToRename && (
        <CourseRenameModal
          courseId={courseToRename.id}
          currentTitle={courseToRename.title}
          onClose={() => setCourseToRename(null)}
          onRenamed={(newTitle) => {
            handleRenamed(courseToRename.id, newTitle);
            setCourseToRename(null);
          }}
        />
      )}

      {courseToAssign && (
        <AssignCourseModal
          courseId={courseToAssign.id}
          courseTitle={courseToAssign.title}
          onClose={() => setCourseToAssign(null)}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete course?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &ldquo;{deleteTarget?.title}&rdquo; and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) handleDelete(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <header className="mb-[30px] flex flex-col gap-[5px]">
        <p className="text-sm leading-tight font-medium">
          <span className="text-[#a0aec0]">Trainings / </span>
          <span className="text-[#2d3748]">Courses</span>
        </p>
        <div className="flex items-center gap-4">
          <h1 className="min-w-0 flex-1 text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
            Courses
          </h1>
          {hasCourses && canCreateCourse && (
            <Button
              id="create-course-btn"
              size="lg"
              onClick={startCreateCourse}
              className="h-10 shrink-0 gap-1.5 rounded-[10px] px-4 text-[13px] font-semibold tracking-[-0.31px] has-[>svg]:px-4 md:h-12 md:gap-2 md:rounded-[12px] md:px-6 md:text-[15.5px] md:has-[>svg]:px-6"
            >
              <Plus className="size-5 md:size-[25px]" aria-hidden="true" />
              Create Course
            </Button>
          )}
        </div>
      </header>

      {showBillingGate && (
        <BillingGateModal
          title="A plan is required to create courses"
          description="Subscribe to a plan to start creating and managing training courses for your organization."
          onClose={() => setShowBillingGate(false)}
        />
      )}

      {actionError && (
        <Alert variant="error" className="mb-4">
          {actionError}
        </Alert>
      )}

      <PendingGenerationBanner />

      {hasCourses ? (
        <div className="flex min-w-0 flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:px-[21px] md:pt-[21px] md:pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                setActiveTab(value as CourseTypeTab);
                setCurrentPage(1);
              }}
            >
              <TabsList
                variant="line"
                className="h-auto w-full justify-start gap-8 rounded-none border-b border-[#f0f2f5] bg-transparent p-0"
              >
                <TabsTrigger value="video" className={TAB_TRIGGER_CLASS}>
                  Video <span className={TAB_COUNT_CLASS}>{tabCounts.video}</span>
                </TabsTrigger>
                <TabsTrigger value="slides" className={TAB_TRIGGER_CLASS}>
                  Reading Course <span className={TAB_COUNT_CLASS}>{tabCounts.slides}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="w-full sm:w-[470px]">
              <Input
                className="h-[38px] rounded-[8.5px] border-[#dfe1e6] pl-9 text-[15px] shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] placeholder:text-[#a4abb8]"
                placeholder="Search for courses..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                aria-label="Search courses"
                startIcon={<Search aria-hidden="true" />}
              />
            </div>
          </div>

          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead className={cn(headCls, 'rounded-l-[9px] md:w-[34%]')}>
                  Course Name
                </TableHead>
                <TableHead className={cn(headCls, 'hidden md:table-cell md:w-[12%]')}>
                  Assigned Staff
                </TableHead>
                <TableHead className={cn(headCls, 'hidden lg:table-cell lg:w-[42%]')}>
                  Description
                </TableHead>
                <TableHead
                  className={cn(headCls, 'w-[56px] rounded-r-[9px] text-right md:w-[12%]')}
                >
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentCourses.length > 0 ? (
                currentCourses.map((course) => {
                  const rowActions = buildRowActions(course);
                  return (
                    <TableRow
                      key={course.id}
                      onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                      className="cursor-pointer"
                    >
                      <TableCell className={cn(cellCls, 'px-2 md:px-[18px]')}>
                        <div className="flex items-center gap-3 sm:gap-[18px]">
                          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f1f5f9]">
                            <Image
                              src={course.thumbnail || '/images/icon-course-blue.svg'}
                              alt={course.title}
                              width={40}
                              height={40}
                              className="object-cover"
                            />
                          </div>
                          <span className="truncate text-[15px] font-semibold tracking-[0.35px] text-[#0d0d12] sm:text-[17.5px]">
                            {course.title}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className={cn(cellCls, 'hidden md:table-cell')}>
                        {course.enrollmentsCount}
                      </TableCell>
                      <TableCell
                        className={cn(
                          cellCls,
                          'hidden px-[18px] text-text-secondary lg:table-cell',
                        )}
                      >
                        <span
                          className="block truncate"
                          title={course.description?.trim() || undefined}
                        >
                          {course.description?.trim() || '—'}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(cellCls, 'overflow-hidden px-1 md:px-2 md:pr-[18px]')}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1 md:gap-2">
                          {rowActions.length > 0 && (
                            <RowActionsMenu
                              className="size-8 rounded-[8px] border border-[#ece4e4] bg-white text-[#0d0d12] [&_svg]:size-4"
                              actions={rowActions}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <EmptyTableState
                  message="No courses found."
                  subMessage="Try adjusting your search or create a new course."
                  colSpan={4}
                  asTableRow
                />
              )}
            </TableBody>
          </Table>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
            <span className="text-xs font-medium tracking-[-0.36px] text-[#9a9a9a]">
              Showing {totalEntries === 0 ? 0 : startIndex + 1} to{' '}
              {Math.min(startIndex + itemsPerPage, totalEntries)} of {totalEntries} entries
            </span>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
                disabled={currentPage === 1}
                onClick={() => handlePageChange(currentPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>

              {buildPaginationRange(currentPage, totalPages).map((page, i) =>
                page === 'ellipsis' ? (
                  <span
                    key={`ellipsis-${i}`}
                    className="flex size-10 items-center justify-center text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]"
                    aria-hidden="true"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={page}
                    variant={page === currentPage ? 'default' : 'ghost'}
                    size="icon-sm"
                    className="size-10 rounded-[8px] text-xs font-medium tracking-[-0.36px] data-[variant=ghost]:text-[#1c1c1c]"
                    onClick={() => handlePageChange(page)}
                    aria-current={page === currentPage ? 'page' : undefined}
                  >
                    {page}
                  </Button>
                ),
              )}

              <Button
                variant="outline"
                size="icon-sm"
                className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
                disabled={currentPage === totalPages || totalPages === 0}
                onClick={() => handlePageChange(currentPage + 1)}
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
                <SelectTrigger className="w-[66px] rounded-[8px] border-[#d9d9d9] px-3 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                </SelectContent>
              </Select>
              entries
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[520px] flex-1 flex-col items-center justify-center rounded-[17px] border border-[#dfe1e6] bg-white px-4 py-10 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:min-h-[700px] md:px-[21px]">
          <div className="flex w-full max-w-[482px] flex-col items-center gap-5">
            <Image
              src="/images/courses-empty-state.svg"
              alt=""
              width={226}
              height={226}
              aria-hidden="true"
              className="size-[170px] md:size-[226px]"
            />
            <div className="flex flex-col gap-[5px] text-center">
              <p className="text-[20px] leading-[1.32] font-semibold text-[#11181c] md:text-[24.5px]">
                No courses yet
              </p>
              <p className="text-[15px] leading-[1.45] text-[#475367] md:text-[16px]">
                Create your first course by uploading a policy or compliance document. Theraptly
                turns it into structured training automatically.
              </p>
            </div>
            {canCreateCourse && (
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <Button
                  id="create-course-btn"
                  size="lg"
                  onClick={startCreateCourse}
                  className="h-12 rounded-[12px] px-6 text-[15.5px] font-semibold tracking-[-0.31px]"
                >
                  Create your first course
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={startPrebuiltCatalog}
                  className="h-12 rounded-[12px] border-[#d4d4d4] px-6 text-[15.5px] font-semibold tracking-[-0.31px] text-primary hover:text-primary"
                >
                  Choose a prebuilt course
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
