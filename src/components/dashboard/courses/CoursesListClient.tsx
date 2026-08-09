'use client';

import { useState, useMemo, useEffect, useCallback, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RowActionsMenu, type RowAction } from '@/components/ui';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { deleteCourse } from '@/app/actions/course';
import BillingGateModal from '@/components/dashboard/billing/BillingGateModal';
import { Plus, Search, Pencil, Trash2, UserPlus, FileText, Play, Library } from 'lucide-react';
import CourseRenameModal from '@/components/dashboard/courses/CourseRenameModal';
import CoursesEmptyState from '@/components/dashboard/courses/CoursesEmptyState';
import CoursesTableFooter from '@/components/dashboard/courses/CoursesTableFooter';
import PendingGenerationBanner from '@/components/dashboard/courses/PendingGenerationBanner';
import { cn } from '@/lib/utils';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

const headCls =
  'h-10 px-2 py-[9px] text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#2a3144] md:px-[18px] md:text-[15.6px]';
const cellCls = 'h-[71px] px-5 text-[15px] font-medium tracking-[0.35px] md:text-[17.4px]';

interface CoursesListClientProps {
  courses: CourseWithStats[];
  /** Whether the organization has an active or trialing billing subscription. */
  hasBilling: boolean;
  /** Viewer's role — every row affordance is rendered from its registry gates. */
  viewerRole: Role;
}

/** Design maps the platform's two course types onto Video / Reading Course tabs. */
type CourseTypeTab = 'video' | 'reading';

/** The persisted discriminant for reading courses stays `text` — only the label changed. */
const COURSE_TYPE_BY_TAB: Record<CourseTypeTab, string> = {
  video: 'video',
  reading: 'text',
};

const TAB_TRIGGER_CLASS =
  '-mb-px flex-none gap-2 rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 py-3 text-[15.75px] font-medium text-[#5d5d5d] shadow-none after:hidden hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-none md:px-8';

const TAB_BADGE_CLASS = 'rounded-full px-[9px] py-[2px] text-[11.4px] font-medium';
const TAB_BADGE_ACTIVE_CLASS = 'bg-[#edeffe] text-primary';
const TAB_BADGE_INACTIVE_CLASS = 'bg-[#f5f5f5] text-[#404040]';

const ROW_MENU_CONTENT_CLASS =
  'w-[226px] rounded-[12px] border-[#e5e7eb] px-0 py-[6px] shadow-[0px_12px_32px_0px_rgba(0,0,0,0.14)]';
const ROW_MENU_ITEM_CLASS = 'rounded-none px-4 py-[11px] text-[13px]';

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
    !courses.some((course) => course.type === COURSE_TYPE_BY_TAB.reading)
      ? 'video'
      : 'reading',
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

  // The Video tab lists only courses already offered to the org, so the catalog
  // of adoptable global courses needs its own way in.
  const startPrebuiltCatalog = useCallback(() => {
    if (!hasBilling) {
      setShowBillingGate(true);
      return;
    }
    router.push('/dashboard/courses/prebuilt');
  }, [hasBilling, router]);

  const selectTab = useCallback((tab: CourseTypeTab) => {
    setActiveTab(tab);
    setCurrentPage(1);
  }, []);

  const tabCounts = useMemo(
    () => ({
      video: courseList.filter((course) => course.type === COURSE_TYPE_BY_TAB.video).length,
      reading: courseList.filter((course) => course.type === COURSE_TYPE_BY_TAB.reading).length,
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

  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentCourses = filteredCourses.slice(startIndex, startIndex + itemsPerPage);
  const totalEntries = filteredCourses.length;

  // Header affordances stay tied to "the org already has courses"; the illustrated
  // panel below is per-tab, and an empty *search* keeps the table chrome instead.
  const hasCourses = courseList.length > 0;
  const isVideoTab = activeTab === 'video';
  const showEmptyPanel = totalEntries === 0 && searchQuery.trim() === '';

  const buildRowActions = (course: CourseWithStats): RowAction[] => {
    const actions: RowAction[] = [];

    if (canAssign) {
      actions.push({
        label: 'Assign to staff',
        icon: <UserPlus className="size-4" />,
        onSelect: () => router.push(`/dashboard/training/courses/${course.id}/assign`),
      });
    }

    // Forked courses (duplicates, adopted prebuilts) carry no CourseVersion, so
    // there is no source document to open.
    if (canReadDocuments && course.sourceDocumentId) {
      actions.push({
        label: 'View Source Document',
        icon: <FileText className="size-4" />,
        onSelect: () => router.push(`/dashboard/documents/${course.sourceDocumentId}`),
      });
    }

    if (canEditCourse) {
      actions.push({
        label: 'Rename',
        icon: <Pencil className="size-4" />,
        onSelect: () => setCourseToRename({ id: course.id, title: course.title }),
      });
    }

    if (canDeleteCourse) {
      actions.push({
        label: deletingId === course.id ? 'Deleting…' : 'Delete',
        icon: <Trash2 className="size-4" />,
        variant: 'destructive',
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
            <div className="flex shrink-0 items-center gap-2 md:gap-3">
              <Button
                id="create-course-btn"
                size="lg"
                onClick={startCreateCourse}
                className="h-10 gap-1.5 rounded-[10px] px-4 text-[13px] font-semibold tracking-[-0.31px] has-[>svg]:px-4 md:h-12 md:gap-2 md:rounded-[12px] md:px-6 md:text-[15.5px] md:has-[>svg]:px-6"
              >
                <Plus className="size-5 md:size-[25px]" aria-hidden="true" />
                Create Course
              </Button>
            </div>
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

      <div className="flex min-w-0 flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:px-[21px] md:pt-[21px] md:pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
          <Tabs value={activeTab} onValueChange={(value) => selectTab(value as CourseTypeTab)}>
            <TabsList
              variant="line"
              className="h-auto w-full justify-start gap-0 rounded-none border-b border-[#f0f2f5] bg-transparent p-0"
            >
              <TabsTrigger value="video" className={TAB_TRIGGER_CLASS}>
                Video{' '}
                <Badge
                  variant="secondary"
                  className={cn(
                    TAB_BADGE_CLASS,
                    isVideoTab ? TAB_BADGE_ACTIVE_CLASS : TAB_BADGE_INACTIVE_CLASS,
                  )}
                >
                  {tabCounts.video}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="reading" className={TAB_TRIGGER_CLASS}>
                Reading Course{' '}
                <Badge
                  variant="secondary"
                  className={cn(
                    TAB_BADGE_CLASS,
                    isVideoTab ? TAB_BADGE_INACTIVE_CLASS : TAB_BADGE_ACTIVE_CLASS,
                  )}
                >
                  {tabCounts.reading}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto">
            <div className="w-full sm:w-[470px] sm:max-w-full">
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
            {isVideoTab && canCreateCourse && (
              <Button
                variant="link"
                onClick={startPrebuiltCatalog}
                className="h-auto shrink-0 justify-start gap-1.5 p-0 text-[14px] font-semibold whitespace-nowrap sm:justify-center"
              >
                <Library className="size-4" aria-hidden="true" />
                Browse course catalog
              </Button>
            )}
          </div>
        </div>

        {showEmptyPanel ? (
          <CoursesEmptyState
            variant={activeTab}
            canCreateCourse={canCreateCourse}
            onCreate={startCreateCourse}
            onSwitchTab={() => selectTab(isVideoTab ? 'reading' : 'video')}
          />
        ) : (
          <>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead
                    className={cn(
                      headCls,
                      'rounded-l-[9px]',
                      isVideoTab ? 'md:w-[36%]' : 'md:w-[38%]',
                    )}
                  >
                    Course Name
                  </TableHead>
                  <TableHead
                    className={cn(
                      headCls,
                      'hidden md:table-cell',
                      isVideoTab ? 'md:w-[12%]' : 'md:w-[17%]',
                    )}
                  >
                    Assigned Staff
                  </TableHead>
                  <TableHead
                    className={cn(
                      headCls,
                      'hidden md:table-cell',
                      isVideoTab ? 'md:w-[32%]' : 'md:w-[27%]',
                    )}
                  >
                    {isVideoTab ? 'Description' : 'Date Created'}
                  </TableHead>
                  <TableHead className={cn(headCls, 'w-[56px] rounded-r-[9px] md:w-[20%]')}>
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentCourses.length > 0 ? (
                  currentCourses.map((course) => {
                    const rowActions = buildRowActions(course);
                    const secondaryValue = isVideoTab
                      ? course.description
                      : new Date(course.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: '2-digit',
                          year: 'numeric',
                        });
                    return (
                      <TableRow
                        key={course.id}
                        onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                        className="cursor-pointer"
                      >
                        <TableCell className={cn(cellCls, 'px-2 md:px-[18px]')}>
                          <div className="flex items-center gap-3 sm:gap-[18px]">
                            {isVideoTab ? (
                              <div className="relative h-[47px] w-[78px] shrink-0 overflow-hidden rounded-[6px] bg-[#f1f5f9]">
                                {/* The icon fallback is a square glyph — cropping it into this
                                    16:9 box mangles it, so posterless videos show the tile alone. */}
                                {course.thumbnail && (
                                  <Image
                                    src={course.thumbnail}
                                    alt={course.title}
                                    width={78}
                                    height={47}
                                    className="size-full object-cover"
                                  />
                                )}
                                <span className="absolute inset-0 flex items-center justify-center">
                                  <span className="flex size-5 items-center justify-center rounded-full bg-white/90">
                                    <Play
                                      className="size-2.5 fill-foreground text-foreground"
                                      aria-hidden="true"
                                    />
                                  </span>
                                </span>
                              </div>
                            ) : (
                              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f1f5f9]">
                                <Image
                                  src={course.thumbnail || '/images/icon-course-blue.svg'}
                                  alt={course.title}
                                  width={40}
                                  height={40}
                                  className="object-cover"
                                />
                              </div>
                            )}
                            <div className="flex min-w-0 flex-1 flex-col justify-center">
                              <span className="truncate text-[15px] font-medium tracking-[0.35px] text-[#1e1e1e] sm:text-[17.6px]">
                                {course.title}
                              </span>
                              <span className="truncate text-[13px] font-normal text-[#464646] md:hidden">
                                {course.enrollmentsCount} assigned
                                {secondaryValue ? ` · ${secondaryValue}` : ''}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className={cn(cellCls, 'hidden text-[#505050] md:table-cell')}>
                          {course.enrollmentsCount}
                        </TableCell>
                        <TableCell className={cn(cellCls, 'hidden text-[#464646] md:table-cell')}>
                          <span className="block truncate">{secondaryValue}</span>
                        </TableCell>
                        <TableCell
                          className={cn(cellCls, 'px-1 md:px-[18px]')}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1 md:gap-3">
                            <Link
                              href={`/dashboard/training/courses/${course.id}`}
                              className="hidden px-4 py-2.5 text-[16px] font-semibold text-primary hover:underline sm:inline-flex"
                            >
                              View
                            </Link>
                            {rowActions.length > 0 && (
                              <RowActionsMenu
                                className="size-8 rounded-[8px] border border-[#ece4e4] bg-white text-[#0d0d12] [&_svg]:size-4"
                                contentClassName={ROW_MENU_CONTENT_CLASS}
                                itemClassName={ROW_MENU_ITEM_CLASS}
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

            <CoursesTableFooter
              totalEntries={totalEntries}
              currentPage={currentPage}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
              onItemsPerPageChange={(next) => {
                setItemsPerPage(next);
                setCurrentPage(1);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
