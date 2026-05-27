'use client';

import React, { useState, useMemo, useEffect, useCallback, useTransition } from 'react';
import styles from './CoursesList.module.css';
import { Button, Input, Select } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CourseWithStats } from '@/types/course';
import { checkCourseGenerationJobV46 } from '@/app/actions/course-ai-v4.6';
import { deleteCourse, updateCourse } from '@/app/actions/course';
import BillingGateModal from '@/components/dashboard/billing/BillingGateModal';

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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        border: '1px solid',
        borderRadius: 10,
        marginBottom: 16,
        fontSize: 14,
        ...(bannerStyles[banner] ?? {}),
      }}
    >
      {banner === 'generating' && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }}
        >
          <circle cx="12" cy="12" r="10" strokeDasharray="40" strokeDashoffset="10" />
          <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
        </svg>
      )}
      <span style={{ flex: 1 }}>
        {banner === 'generating' && 'Your course is still being generated in the background…'}
        {banner === 'done' &&
          '✅ Course generation complete! Resume the wizard to review and publish.'}
        {banner === 'failed' && '⚠️ Course generation failed. Please start a new course.'}
      </span>
      {banner === 'done' && (
        <Link
          href="/dashboard/courses/create"
          style={{
            fontWeight: 600,
            color: '#38A169',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Resume Setup →
        </Link>
      )}
      <button
        onClick={dismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, padding: 4 }}
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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Rename course"
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: '1.5rem',
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827', margin: '0 0 1rem' }}>
          Rename Course
        </h2>
        <form onSubmit={handleSubmit}>
          <input
            style={{
              width: '100%',
              padding: '0.625rem 0.875rem',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontFamily: 'inherit',
              color: '#111827',
              boxSizing: 'border-box',
            }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            disabled={isPending}
            aria-label="New course title"
          />
          {error && (
            <p style={{ color: '#dc2626', fontSize: '0.8125rem', marginTop: '0.375rem' }}>
              {error}
            </p>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '1.25rem',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                background: '#fff',
                color: '#374151',
                fontSize: '0.875rem',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              style={{
                padding: '0.5rem 1.25rem',
                border: 'none',
                borderRadius: 8,
                background: '#4731f7',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
                opacity: isPending ? 0.6 : 1,
              }}
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
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [courseToRename, setCourseToRename] = useState<{ id: string; title: string } | null>(null);
  const [, startTransition] = useTransition();

  // Sync when server props change after revalidatePath
  useEffect(() => {
    setCourseList(courses);
  }, [courses]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleDelete = useCallback(
    (e: React.MouseEvent, course: CourseWithStats) => {
      e.stopPropagation();
      setActiveDropdown(null);
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
        <p
          role="alert"
          style={{
            color: '#dc2626',
            fontSize: '0.875rem',
            marginBottom: '0.75rem',
            padding: '0.5rem 0.75rem',
            background: '#fef2f2',
            borderRadius: 6,
          }}
        >
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
              setCurrentPage(1); // Reset to page 1 on search
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
                style={{ color: '#A0AEC0' }}
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            }
          />
        </div>

        {/* Table */}
        {/* Table */}
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: '40%' }}>Course Name</th>
              <th style={{ width: '15%' }}>Assigned Staff</th>
              <th style={{ width: '15%' }}>Role</th>
              <th style={{ width: '20%' }}>Date Created</th>
              <th style={{ width: '10%' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {currentCourses.length > 0 ? (
              currentCourses.map((course) => (
                <tr
                  key={course.id}
                  onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                  style={{ cursor: 'pointer' }}
                  className={styles.clickableRow}
                >
                  <td>
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
                  </td>
                  <td>{course.enrollmentsCount}</td>
                  <td>General</td>
                  <td>
                    {new Date(course.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td>
                    <div className={styles.actionCell} onClick={(e) => e.stopPropagation()}>
                      <div className={styles.dropdownContainer}>
                        <button
                          className={styles.moreActionBtn}
                          aria-label="More actions"
                          aria-expanded={activeDropdown === course.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDropdown(activeDropdown === course.id ? null : course.id);
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="5" r="1.5" />
                            <circle cx="12" cy="12" r="1.5" />
                            <circle cx="12" cy="19" r="1.5" />
                          </svg>
                        </button>

                        {activeDropdown === course.id && (
                          <div className={styles.dropdownMenu} role="menu">
                            {/* View */}
                            <button
                              className={styles.dropdownItem}
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDropdown(null);
                                router.push(`/dashboard/training/courses/${course.id}`);
                              }}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ marginRight: 8 }}
                                aria-hidden="true"
                              >
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              View
                            </button>

                            {/* Rename */}
                            <button
                              className={styles.dropdownItem}
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDropdown(null);
                                setCourseToRename({ id: course.id, title: course.title });
                              }}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ marginRight: 8 }}
                                aria-hidden="true"
                              >
                                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                              </svg>
                              Rename
                            </button>

                            {/* Delete */}
                            <button
                              className={`${styles.dropdownItem} ${styles.deleteItem} ${
                                deletingId === course.id ? (styles.dropdownItemDisabled ?? '') : ''
                              }`}
                              role="menuitem"
                              disabled={deletingId === course.id}
                              title={deletingId === course.id ? 'Deleting…' : 'Delete course'}
                              onClick={(e) => handleDelete(e, course)}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ marginRight: 8 }}
                                aria-hidden="true"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                              {deletingId === course.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyTableState
                message="No courses found."
                subMessage="Try adjusting your search or create a new course."
                colSpan={3}
                asTableRow
              />
            )}
          </tbody>
        </table>

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
