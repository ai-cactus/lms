'use client';

import React, { useState, useMemo, useEffect, useCallback, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RowActionsMenu } from '@/components/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { deleteCourse, updateCourse } from '@/app/actions/course';
import BillingGateModal from '@/components/dashboard/billing/BillingGateModal';
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

const PENDING_KEY = 'lms_pending_generation';
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

interface PendingGeneration {
  jobId: string;
  formData: Record<string, unknown>;
  timestamp: number;
}

type BannerState = 'generating' | 'done' | 'failed' | 'hidden';

const bannerClasses: Record<Exclude<BannerState, 'hidden'>, string> = {
  generating: 'border-[#4C6EF5] bg-[#EBF4FF] text-[#1e3a8a]',
  done: 'border-[#38A169] bg-[#F0FFF4] text-[#1a4731]',
  failed: 'border-[#E53E3E] bg-[#FFF5F5] text-[#742a2a]',
};

function PendingGenerationBanner() {
  const [banner, setBanner] = useState<BannerState>('hidden');
  const [pending, setPending] = useState<PendingGeneration | null>(null);

  const dismiss = useCallback(() => {
    localStorage.removeItem(PENDING_KEY);
    setBanner('hidden');
  }, []);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PENDING_KEY);
    } catch {
      return; // localStorage unavailable
    }
    if (!raw) return;

    let parsed: PendingGeneration;
    try {
      parsed = JSON.parse(raw) as PendingGeneration;
    } catch {
      localStorage.removeItem(PENDING_KEY);
      return;
    }

    // Discard entries older than 1 hour
    if (Date.now() - parsed.timestamp > STALE_THRESHOLD_MS) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: initialising banner state from localStorage inside effect
    setPending(parsed);

    setBanner('generating');

    // Poll until done
    const interval = setInterval(async () => {
      try {
        const res = await checkCourseGenerationJobV46(parsed.jobId);
        if (res.status === 'completed') {
          clearInterval(interval);
          setBanner('done');
        } else if (res.status === 'failed' || res.error) {
          clearInterval(interval);
          setBanner('failed');
        }
      } catch {
        // network blip — keep polling
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  if (banner === 'hidden' || !pending) return null;

  return (
    <div
      className={`flex items-center gap-3 rounded-[10px] border px-4 py-3 mb-4 text-sm ${bannerClasses[banner]}`}
    >
      {banner === 'generating' && (
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      )}
      <span className="flex-1">
        {banner === 'generating' && 'Your course is still being generated in the background…'}
        {banner === 'done' &&
          '✅ Course generation complete! Resume the wizard to review and publish.'}
        {banner === 'failed' && '⚠️ Course generation failed. Please start a new course.'}
      </span>
      {banner === 'done' && (
        <Link
          href="/dashboard/courses/create"
          className="font-semibold text-[#38A169] no-underline whitespace-nowrap"
        >
          Resume Setup →
        </Link>
      )}
      <button
        onClick={dismiss}
        className="bg-none border-none cursor-pointer opacity-60 p-1"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lightweight inline rename modal for courses
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
    <div
      className="fixed inset-0 bg-black/45 flex items-center justify-center z-[1000] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Rename course"
    >
      <div className="bg-white rounded-xl p-6 w-full max-w-[420px] shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
        <h2 className="text-lg font-semibold text-[#111827] mb-4">Rename Course</h2>
        <form onSubmit={handleSubmit}>
          <Input
            className="h-11"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            disabled={isPending}
            aria-label="New course title"
          />
          {error && <p className="text-red-600 text-[0.8125rem] mt-1.5">{error}</p>}
          <div className="flex justify-end gap-3 mt-5">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface CoursesListClientProps {
  courses: CourseWithStats[];
  /** Whether the organization has an active or trialing billing subscription. */
  hasBilling: boolean;
}

export default function CoursesListClient({ courses, hasBilling }: CoursesListClientProps) {
  const router = useRouter();
  const [courseList, setCourseList] = useState<CourseWithStats[]>(courses);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showBillingGate, setShowBillingGate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [courseToRename, setCourseToRename] = useState<{ id: string; title: string } | null>(null);
  const [, startTransition] = useTransition();

  // Sync when server props change after revalidatePath
  useEffect(() => {
    setCourseList(courses);
  }, [courses]);

  const handleDelete = useCallback(
    (course: CourseWithStats) => {
      if (
        !confirm(
          `Delete "${course.title}"?\n\nThis will permanently remove the course and cannot be undone.`,
        )
      ) {
        return;
      }
      setDeletingId(course.id);
      setDeleteError(null);
      startTransition(async () => {
        try {
          await deleteCourse(course.id);
          setCourseList((prev) => prev.filter((c) => c.id !== course.id));
        } catch (err) {
          setDeleteError(err instanceof Error ? err.message : 'Failed to delete course.');
        }
        setDeletingId(null);
      });
    },
    [startTransition],
  );

  const handleRenamed = useCallback((courseId: string, newTitle: string) => {
    setCourseList((prev) => prev.map((c) => (c.id === courseId ? { ...c, title: newTitle } : c)));
  }, []);

  // Filter Logic
  const filteredCourses = useMemo(() => {
    return courseList.filter((course) =>
      course.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [courseList, searchQuery]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredCourses.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentCourses = filteredCourses.slice(startIndex, startIndex + itemsPerPage);
  const totalEntries = filteredCourses.length;

  // Handle Page Change
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      {/* Rename modal */}
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

      {/* Header */}
      <div className="mb-8 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div>
          <div className="mb-2 text-sm text-[#718096]">Trainings / Courses</div>
          <h1 className="text-2xl font-bold text-[#1a202c]">Courses</h1>
        </div>
        <Button
          id="create-course-btn"
          onClick={() => {
            if (!hasBilling) {
              setShowBillingGate(true);
              return;
            }
            router.push('/dashboard/courses/create');
          }}
        >
          <Plus className="size-5" />
          Create Course
        </Button>
      </div>

      {/* Billing gate */}
      {showBillingGate && (
        <BillingGateModal
          title="A plan is required to create courses"
          description="Subscribe to a plan to start creating and managing training courses for your organization."
          onClose={() => setShowBillingGate(false)}
        />
      )}

      {/* Delete error banner */}
      {deleteError && (
        <p role="alert" className="text-red-600 text-sm mb-3 px-3 py-2 bg-red-50 rounded-md">
          ⚠️ {deleteError}
        </p>
      )}

      <PendingGenerationBanner />

      <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
        {/* Search */}
        <div className="mb-6 w-full sm:w-[380px]">
          <Input
            className="h-11"
            placeholder="Search for courses..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            startIcon={<Search aria-hidden="true" />}
          />
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead style={{ width: '40%' }}>Course Name</TableHead>
              <TableHead className="hidden md:table-cell" style={{ width: '15%' }}>
                Assigned Staff
              </TableHead>
              <TableHead className="hidden md:table-cell" style={{ width: '15%' }}>
                Role
              </TableHead>
              <TableHead className="hidden lg:table-cell" style={{ width: '20%' }}>
                Date Created
              </TableHead>
              <TableHead className="text-right" style={{ width: '10%' }}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentCourses.length > 0 ? (
              currentCourses.map((course) => (
                <TableRow
                  key={course.id}
                  onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <div className="flex items-center gap-4">
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f1f5f9]">
                        <Image
                          src={course.thumbnail || '/images/icon-course-blue.svg'}
                          alt={course.title}
                          width={40}
                          height={40}
                          className="object-cover"
                        />
                      </div>
                      <div>
                        <span className="font-semibold text-[#1a202c]">{course.title}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{course.enrollmentsCount}</TableCell>
                  <TableCell className="hidden md:table-cell">General</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {new Date(course.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/dashboard/training/courses/${course.id}`}
                        className="hidden text-sm font-semibold text-primary hover:underline sm:inline-flex"
                      >
                        View
                      </Link>
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'Rename',
                            icon: <Pencil className="size-4" />,
                            onSelect: () =>
                              setCourseToRename({ id: course.id, title: course.title }),
                          },
                          {
                            label: deletingId === course.id ? 'Deleting…' : 'Delete',
                            icon: <Trash2 className="size-4" />,
                            variant: 'destructive',
                            separatorBefore: true,
                            disabled: deletingId === course.id,
                            onSelect: () => handleDelete(course),
                          },
                        ]}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <EmptyTableState
                message="No courses found."
                subMessage="Try adjusting your search or create a new course."
                colSpan={5}
                asTableRow
              />
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[#edf2f7] pt-4">
          <div className="text-sm text-[#718096]">
            Showing {totalEntries === 0 ? 0 : startIndex + 1} to{' '}
            {Math.min(startIndex + itemsPerPage, totalEntries)} of {totalEntries} entries
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={currentPage === 1}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={page === currentPage ? 'default' : 'outline'}
                size="icon-sm"
                onClick={() => handlePageChange(page)}
              >
                {page}
              </Button>
            ))}

            <Button
              variant="outline"
              size="icon-sm"
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-sm text-[#718096]">
            <span>Show</span>
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(v) => {
                setItemsPerPage(Number(v));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
              </SelectContent>
            </Select>
            <span>entries</span>
          </div>
        </div>
      </div>
    </div>
  );
}
