'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleX, Lock, Clock, Search, Layers, AlertCircle } from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';

interface Course {
  id: string;
  title: string;
  category?: string | null;
  status: string;
  progress: number;
  deadline?: Date | string | null;
  duration?: number;
  quizAttempts?: { id: string; attemptCount: number; timeTaken: number | null }[];
  retakeOf?: string | null;
  enrollmentId?: string;
}

interface WorkerCourseListProps {
  courses: Course[];
}

const badgeBase =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold';

export default function WorkerCourseList({ courses }: WorkerCourseListProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const filtered = courses.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));

  const handleStartClick = (courseId: string) => {
    router.push(`/worker/courses/${courseId}`);
  };

  const handleViewResultClick = (courseId: string) => {
    router.push(`/worker/courses/${courseId}`);
  };

  const getStatusBadge = (
    status: string,
    progress: number,
    quizAttempts?: { id: string; attemptCount: number; timeTaken: number | null }[],
  ) => {
    if (status === 'attested') {
      return (
        <span className={`${badgeBase} bg-[#d1fae5] text-[#065f46]`}>
          <Check className="size-3" aria-hidden="true" />
          Attested
        </span>
      );
    }
    if (status === 'completed') {
      return (
        <span className={`${badgeBase} bg-[#dbeafe] text-[#1d4ed8]`}>
          <Check className="size-3" aria-hidden="true" />
          Completed
        </span>
      );
    }
    if (status === 'failed') {
      return (
        <span className={`${badgeBase} bg-[#fee2e2] text-[#dc2626]`}>
          <CircleX className="size-3" aria-hidden="true" />
          Failed
        </span>
      );
    }

    if (status === 'locked') {
      return (
        <div className="flex flex-col gap-1">
          <span className={`${badgeBase} bg-[#FEE2E2] text-[#DC2626]`}>
            <Lock className="size-3" aria-hidden="true" />
            Locked
          </span>
          <span className="text-[10px] text-[#EF4444]">Max attempts reached</span>
        </div>
      );
    }

    // Default to In Progress or Assigned
    const isStarted = progress > 0 || status === 'in_progress';
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
        {isStarted && quizAttempts && (
          <span className="pl-1 text-[10px] text-[#A0AEC0]">
            Attempt{' '}
            {quizAttempts[0]
              ? quizAttempts[0].timeTaken === null
                ? quizAttempts[0].attemptCount
                : quizAttempts[0].attemptCount + 1
              : 1}
          </span>
        )}
      </div>
    );
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
        <h2 className="text-lg font-bold text-[#1a202c]">My Courses</h2>
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

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm [-webkit-overflow-scrolling:touch]">
        <table className="w-full border-collapse text-sm">
          <thead className="max-md:hidden">
            <tr>
              <th className="w-[35%] border-b border-[#e2e8f0] bg-[#f1f5f9] px-6 py-4 text-left font-semibold text-[#64748b]">
                Name
              </th>
              <th className="w-[20%] border-b border-[#e2e8f0] bg-[#f1f5f9] px-6 py-4 text-left font-semibold text-[#64748b]">
                Progress
              </th>
              <th className="w-[15%] border-b border-[#e2e8f0] bg-[#f1f5f9] px-6 py-4 text-left font-semibold text-[#64748b]">
                Deadline
              </th>
              <th className="w-[15%] border-b border-[#e2e8f0] bg-[#f1f5f9] px-6 py-4 text-left font-semibold text-[#64748b]">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.map((course) => {
                const isCompleted = course.status === 'completed' || course.status === 'attested';
                const isLocked = course.status === 'locked';

                return (
                  <tr
                    key={course.id + '-' + course.enrollmentId}
                    onClick={() => {
                      if (isLocked) return;
                      if (isCompleted) {
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
                      {getStatusBadge(course.status, course.progress, course.quizAttempts)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <EmptyTableState
                message="No courses found."
                subMessage="You haven't been assigned any courses yet."
                colSpan={4}
                asTableRow
              />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
