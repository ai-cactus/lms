'use client';

import React, { useState, useMemo, useEffect, useCallback, useTransition } from 'react';
import styles from './CoursesList.module.css';
import { Button, Input, Select } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CourseWithStats } from '@/types/course';
import { checkCourseGenerationJobV46 } from '@/app/actions/course-ai-v4.6';
import { deleteCourse, updateCourse } from '@/app/actions/course';
import BillingGateModal from '@/components/dashboard/billing/BillingGateModal';
import { MoreVertical, Eye, Pencil, Trash2 } from 'lucide-react';

const PENDING_KEY = 'lms_pending_generation';
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

interface PendingGeneration {
  jobId: string;
  formData: Record<string, unknown>;
  timestamp: number;
}

type BannerState = 'generating' | 'done' | 'failed' | 'hidden';

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

  const bannerStyles: Record<string, React.CSSProperties> = {
    generating: { background: '#EBF4FF', borderColor: '#4C6EF5', color: '#1e3a8a' },
    done: { background: '#F0FFF4', borderColor: '#38A169', color: '#1a4731' },
    failed: { background: '#FFF5F5', borderColor: '#E53E3E', color: '#742a2a' },
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border rounded-[10px] mb-4 text-sm"
      style={bannerStyles[banner]}
    >
      {banner === 'generating' && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 animate-spin"
        >
          <circle cx="12" cy="12" r="10" strokeDasharray="40" strokeDashoffset="10" />
        </svg>
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
          <input
            className="w-full py-2.5 px-3.5 border border-[#d1d5db] rounded-lg text-sm font-[inherit] text-[#111827] box-border"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            disabled={isPending}
            aria-label="New course title"
          />
          {error && <p className="text-red-600 text-[0.8125rem] mt-1.5">{error}</p>}
          <div className="flex justify-end gap-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="py-2 px-4 border border-[#d1d5db] rounded-lg bg-white text-[#374151] text-sm font-[inherit] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="py-2 px-5 border-none rounded-lg bg-[#4731f7] text-white text-sm font-semibold font-[inherit] cursor-pointer"
              style={{ opacity: isPending ? 0.6 : 1 }}
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
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
    (e: React.MouseEvent, course: CourseWithStats) => {
      e.stopPropagation();
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
    <div className={styles.container}>
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
      <div className={styles.header}>
        <div>
          <div className={styles.breadcrumbs}>Trainings / Courses</div>
          <h1 className={styles.title}>Courses</h1>
        </div>
        <Button
          id="create-course-btn"
          className={styles.createButton}
          onClick={() => {
            if (!hasBilling) {
              setShowBillingGate(true);
              return;
            }
            router.push('/dashboard/courses/create');
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
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

      <div className={styles.card}>
        {/* Search */}
        <div className={styles.searchContainer}>
          <Input
            placeholder="Search for courses..."
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            leftIcon={
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-slate-400"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            }
          />
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead style={{ width: '40%' }}>Course Name</TableHead>
              <TableHead style={{ width: '15%' }}>Assigned Staff</TableHead>
              <TableHead style={{ width: '15%' }}>Role</TableHead>
              <TableHead style={{ width: '20%' }}>Date Created</TableHead>
              <TableHead style={{ width: '10%' }}></TableHead>
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
                    <div className={styles.courseInfo}>
                      <div className={styles.courseIcon}>
                        <Image
                          src={course.thumbnail || '/images/icon-course-blue.svg'}
                          alt={course.title}
                          width={40}
                          height={40}
                        />
                      </div>
                      <div>
                        <span className={styles.courseName}>{course.title}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{course.enrollmentsCount}</TableCell>
                  <TableCell>General</TableCell>
                  <TableCell>
                    {new Date(course.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={styles.moreActionBtn}
                          aria-label="More actions"
                          aria-haspopup="menu"
                        >
                          <MoreVertical size={16} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[160px]">
                        {/* View */}
                        <DropdownMenuItem
                          onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                          className="gap-2 cursor-pointer"
                        >
                          <Eye size={14} />
                          View
                        </DropdownMenuItem>

                        {/* Rename */}
                        <DropdownMenuItem
                          onClick={() => setCourseToRename({ id: course.id, title: course.title })}
                          className="gap-2 cursor-pointer"
                        >
                          <Pencil size={14} />
                          Rename
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        {/* Delete */}
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={deletingId === course.id}
                          onClick={(e) => handleDelete(e, course)}
                          className="gap-2 cursor-pointer"
                        >
                          <Trash2 size={14} />
                          {deletingId === course.id ? 'Deleting…' : 'Delete'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
        <div className={styles.pagination}>
          <div className={styles.paginationInfo}>
            Showing {totalEntries === 0 ? 0 : startIndex + 1} to{' '}
            {Math.min(startIndex + itemsPerPage, totalEntries)} of {totalEntries} entries
          </div>

          <div className={styles.paginationCenter}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={styles.pageButton}
              disabled={currentPage === 1}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </Button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={page === currentPage ? 'primary' : 'ghost'}
                size="sm"
                className={`${styles.pageButton} ${page === currentPage ? styles.active : ''}`}
                onClick={() => handlePageChange(page)}
              >
                {page}
              </Button>
            ))}

            <Button
              variant="ghost"
              size="icon-sm"
              className={styles.pageButton}
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </Button>
          </div>

          <div className={styles.paginationRight}>
            Show
            <Select
              value={itemsPerPage.toString()}
              onChange={(value) => {
                setItemsPerPage(Number(value));
                setCurrentPage(1);
              }}
              options={[
                { label: '5', value: '5' },
                { label: '10', value: '10' },
                { label: '20', value: '20' },
              ]}
              size="sm"
              direction="up"
              className={styles.entriesSelect}
            />
            entries
          </div>
        </div>
      </div>
    </div>
  );
}
