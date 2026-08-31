'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  CircleX,
  Lock,
  Clock,
  Search,
  Layers,
  AlertCircle,
  Download,
  Eye,
  RotateCcw,
} from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { Alert } from '@/components/ui/alert';
import { RowActionsMenu, type RowAction } from '@/components/ui/RowActionsMenu';
import { logger } from '@/lib/logger';
import type { LearnerCourseAttempt, LearnerCourseRow } from '@/types/enrollment';

interface WorkerCourseListProps {
  courses: LearnerCourseRow[];
  /** The trainings page renders this inside a tab that already names it. */
  showHeading?: boolean;
}

const RETAKE_FALLBACK = 'We could not start your retake. Please try again.';

const badgeBase =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold';

const headCls =
  'border-b border-[#e2e8f0] bg-[#f1f5f9] px-6 py-4 text-left font-semibold text-[#64748b]';

/**
 * What the learner can do with this row right now.
 *
 * `EnrollmentStatus.failed` is never written by the app — a failed attempt that
 * still has retries left leaves the enrollment `in_progress` and only the
 * attempt score records the failure — so "failed" is derived from the latest
 * COMPLETED attempt against the course's real passing score, never from status.
 */
type RowState = 'start' | 'continue' | 'retry' | 'locked' | 'retake' | 'done';

function latestCompletedAttempt(
  quizAttempts: LearnerCourseAttempt[] | undefined,
): LearnerCourseAttempt | undefined {
  return quizAttempts?.find((attempt) => attempt.timeTaken !== null);
}

function deriveRowState(course: LearnerCourseRow): RowState {
  if (course.status === 'completed' || course.status === 'attested') return 'done';
  if (course.status === 'locked') return 'locked';
  if (course.retakeOf && (course.status === 'enrolled' || course.status === 'assigned')) {
    return 'retake';
  }

  const attempt = latestCompletedAttempt(course.quizAttempts);
  const failedLatest =
    attempt != null && course.passingScore != null && attempt.score < course.passingScore;
  if (course.status === 'failed' || failedLatest) return 'retry';

  if (course.status === 'in_progress' || course.progress > 0) return 'continue';
  return 'start';
}

export default function WorkerCourseList({ courses, showHeading = true }: WorkerCourseListProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, startTransition] = useTransition();

  const filtered = courses.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));

  const handleStartClick = (courseId: string) => {
    router.push(`/worker/courses/${courseId}`);
  };

  // The learner's only surface for a graded attempt is the player's review step,
  // which `/learn/[id]` seeds itself into for any scored or locked enrollment.
  // The course preview at /worker/courses/[id] shows no result at all.
  const handleViewResultClick = (courseId: string) => {
    router.push(`/learn/${courseId}`);
  };

  const handleRetakeQuiz = (course: LearnerCourseRow) => {
    if (!course.enrollmentId) return;
    const { enrollmentId } = course;
    setActionError('');

    startTransition(async () => {
      try {
        const { retakeQuiz } = await import('@/app/actions/course');
        const result = await retakeQuiz(enrollmentId);
        // Refusals are RETURNED, not thrown — surface the server's reason rather
        // than a generic failure the learner cannot act on.
        if (!result.success) {
          setActionError(result.refusedReason ?? RETAKE_FALLBACK);
          return;
        }
        router.push(`/worker/courses/${course.id}`);
      } catch (err) {
        logger.error({
          msg: '[worker] Failed to start quiz retake',
          err,
          enrollmentId,
          courseId: course.id,
        });
        setActionError(RETAKE_FALLBACK);
      }
    });
  };

  const getStatusBadge = (course: LearnerCourseRow, rowState: RowState) => {
    if (course.status === 'attested') {
      return (
        <span className={`${badgeBase} bg-[#d1fae5] text-[#065f46]`}>
          <Check className="size-3" aria-hidden="true" />
          Attested
        </span>
      );
    }
    if (course.status === 'completed') {
      return (
        <span className={`${badgeBase} bg-[#dbeafe] text-[#1d4ed8]`}>
          <Check className="size-3" aria-hidden="true" />
          Completed
        </span>
      );
    }
    if (course.status === 'failed') {
      return (
        <span className={`${badgeBase} bg-[#fee2e2] text-[#dc2626]`}>
          <CircleX className="size-3" aria-hidden="true" />
          Failed
        </span>
      );
    }

    if (rowState === 'retake') {
      return (
        <span className={`${badgeBase} bg-error/10 text-error`}>
          <RotateCcw className="size-3" aria-hidden="true" />
          Retake required
        </span>
      );
    }

    if (course.status === 'locked') {
      return (
        <div className="flex flex-col gap-1">
          <span className={`${badgeBase} bg-[#FEE2E2] text-[#DC2626]`}>
            <Lock className="size-3" aria-hidden="true" />
            Locked
          </span>
          {/* The learner cannot self-retake once attempts are exhausted; only an
              admin's assignRetake reopens this course. Name that, rather than
              restating the cause. */}
          <span className="text-[10px] text-[#EF4444]">Awaiting admin retake</span>
        </div>
      );
    }

    // Default to In Progress or Assigned
    const isStarted = course.progress > 0 || course.status === 'in_progress';
    const latestAttempt = course.quizAttempts?.[0];
    // Once the worker has passed the latest completed attempt they only need to
    // attest, so suppress the "next attempt" hint entirely.
    const passedLatest =
      latestAttempt != null &&
      latestAttempt.timeTaken !== null &&
      course.passingScore != null &&
      latestAttempt.score >= course.passingScore;
    const attemptNumber = latestAttempt
      ? latestAttempt.timeTaken === null
        ? latestAttempt.attemptCount
        : latestAttempt.attemptCount + 1
      : 1;
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className={[
            badgeBase,
            isStarted ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#f1f5f9] text-[#64748b]',
          ].join(' ')}
        >
          <Clock className="size-3" aria-hidden="true" />
          {isStarted ? 'In progress' : 'Assigned'}
        </span>
        {isStarted && course.quizAttempts && !passedLatest && (
          <span className="pl-1 text-[10px] text-[#A0AEC0]">Attempt {attemptNumber}</span>
        )}
      </div>
    );
  };

  const getRowActions = (course: LearnerCourseRow, rowState: RowState): RowAction[] => {
    const viewResult: RowAction = {
      label: 'View result',
      icon: <Eye className="size-4" aria-hidden="true" />,
      onSelect: () => handleViewResultClick(course.id),
    };
    const downloadCertificate: RowAction | null = course.certificateId
      ? {
          label: 'Download certificate',
          icon: <Download className="size-4" aria-hidden="true" />,
          href: `/api/certificates/${course.certificateId}`,
        }
      : null;
    const retakeQuizAction: RowAction = {
      label: 'Retake quiz',
      icon: <RotateCcw className="size-4" aria-hidden="true" />,
      disabled: pending || !course.enrollmentId,
      onSelect: () => handleRetakeQuiz(course),
    };

    switch (rowState) {
      case 'done':
        return downloadCertificate ? [viewResult, downloadCertificate] : [viewResult];
      case 'locked':
      case 'retake':
        return [viewResult];
      case 'retry':
        return [retakeQuizAction, viewResult];
      case 'continue':
        return latestCompletedAttempt(course.quizAttempts) ? [viewResult] : [];
      default:
        return [];
    }
  };

  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return <span className="text-sm text-[#cbd5e1]">No deadline</span>;
    const d = new Date(date);
    const isOverdue = d < new Date();
    const text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (isOverdue) {
      return (
        <span className="flex items-center gap-1.5 font-medium text-[#dc2626]">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          Due {text}
        </span>
      );
    }
    return <span className="text-[#4a5568]">{text}</span>;
  };

  return (
    <section>
      <div className="mb-4 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center sm:gap-0">
        {showHeading ? (
          <h2 className="text-lg font-bold text-[#1a202c]">My Courses</h2>
        ) : (
          <span aria-hidden="true" />
        )}
        <div className="flex w-full items-center gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3.5 py-2 transition-all focus-within:border-[#4730f7] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(71,48,247,0.08)] sm:w-auto">
          <Search className="size-4 shrink-0 text-[#94A3B8]" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search for courses..."
            className="w-full bg-transparent text-sm text-[#1a202c] outline-none placeholder:text-[#94a3b8] sm:w-[200px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {actionError && (
        <Alert variant="error" className="mb-4">
          {actionError}
        </Alert>
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm [-webkit-overflow-scrolling:touch]">
        <table className="w-full border-collapse text-sm">
          <thead className="max-md:hidden">
            <tr>
              <th className={`w-[32%] ${headCls}`}>Name</th>
              <th className={`w-[18%] ${headCls}`}>Progress</th>
              <th className={`w-[15%] ${headCls}`}>Deadline</th>
              <th className={`w-[17%] ${headCls}`}>Status</th>
              <th className={`w-[18%] ${headCls}`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.map((course) => {
                const rowState = deriveRowState(course);
                const isLocked = rowState === 'locked';
                const isDone = rowState === 'done';
                const actions = getRowActions(course, rowState);

                const actionLabel =
                  rowState === 'done'
                    ? 'View'
                    : rowState === 'retake'
                      ? 'Retake'
                      : rowState === 'retry'
                        ? 'Retry'
                        : rowState === 'continue'
                          ? 'Continue'
                          : rowState === 'start'
                            ? 'Start'
                            : null;
                const actionIsUrgent = rowState === 'retake' || rowState === 'retry';

                return (
                  <tr
                    key={course.id + '-' + course.enrollmentId}
                    onClick={() => {
                      if (isLocked) return;
                      if (isDone) {
                        handleViewResultClick(course.id);
                      } else {
                        handleStartClick(course.id);
                      }
                    }}
                    className={[
                      'border-b border-[#f1f5f9] last:border-b-0 max-md:block max-md:p-4',
                      isLocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <td className="px-6 py-4 align-middle text-[#1a202c] max-md:block max-md:border-none max-md:px-0 max-md:py-1 max-md:first:mb-2">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-md bg-[#1e293b] text-white">
                          <Layers className="size-4" aria-hidden="true" />
                        </div>
                        <span className="font-semibold text-[#1a202c]">
                          {course.retakeOf ? (
                            <span className="mr-2 font-semibold text-[#E53E3E]">Retake:</span>
                          ) : null}
                          {course.title}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-middle text-[#1a202c] max-md:block max-md:border-none max-md:px-0 max-md:py-1">
                      <div className="flex max-w-[200px] items-center gap-2.5 md:max-w-none">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e2e8f0]">
                          <div
                            className="h-full rounded-full bg-[#4730F7] transition-[width] duration-500"
                            style={{ width: `${course.progress}%` }}
                          />
                        </div>
                        <span className="w-9 text-right text-xs font-semibold text-[#64748b]">
                          {course.progress}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-middle text-[#1a202c] max-md:mr-3 max-md:inline-flex max-md:border-none max-md:px-0 max-md:py-1 max-md:text-xs">
                      {formatDate(course.deadline)}
                    </td>
                    <td className="px-6 py-4 align-middle text-[#1a202c] max-md:mr-3 max-md:inline-flex max-md:border-none max-md:px-0 max-md:py-1 max-md:text-xs">
                      {getStatusBadge(course, rowState)}
                    </td>
                    <td
                      className="px-6 py-4 align-middle max-md:mt-2 max-md:block max-md:border-none max-md:px-0 max-md:py-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1">
                        {actionLabel && (
                          <button
                            type="button"
                            className={[
                              'rounded-md px-1 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                              actionIsUrgent ? 'text-error' : 'text-primary',
                            ].join(' ')}
                            onClick={() =>
                              isDone
                                ? handleViewResultClick(course.id)
                                : handleStartClick(course.id)
                            }
                          >
                            {actionLabel}
                          </button>
                        )}
                        {actions.length > 0 && (
                          <RowActionsMenu
                            actions={actions}
                            label={`Actions for ${course.title}`}
                            className="size-8"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <EmptyTableState
                message="No courses found."
                subMessage="You haven't been assigned any courses yet."
                colSpan={5}
                asTableRow
              />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
