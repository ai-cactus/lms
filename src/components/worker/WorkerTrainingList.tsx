'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Clock, AlertCircle } from 'lucide-react';

function formatCategory(category: string): string {
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Human-readable deadline with overdue styling, mirroring the dashboard table. */
function DeadlineMeta({ deadline }: { deadline?: Date | string | null }) {
  if (!deadline) {
    return <span className="text-xs text-[#cbd5e1]">No deadline</span>;
  }
  const d = new Date(deadline);
  const isOverdue = d < new Date();
  const text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (isOverdue) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-[#dc2626]">
        <AlertCircle className="size-3.5" aria-hidden="true" />
        Due {text}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-[#718096]">
      <Clock className="size-3.5" aria-hidden="true" />
      Due {text}
    </span>
  );
}

interface Course {
  id: string;
  title: string;
  category?: string | null;
  status: string;
  progress: number;
  deadline?: Date | string | null;
  duration?: number;
  retakeOf?: string | null;
  enrollmentId?: string;
  quizAttempts?: { id: string; attemptCount: number; timeTaken: number | null }[];
}

interface WorkerTrainingListProps {
  courses: Course[];
}

type TabKey = 'active' | 'completed';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
];

export default function WorkerTrainingList({ courses }: WorkerTrainingListProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('active');

  const handleStartClick = (courseId: string) => {
    router.push(`/learn/${courseId}`);
  };

  const handleViewResultClick = (courseId: string) => {
    router.push(`/worker/courses/${courseId}`);
  };

  // Split courses into active and completed buckets
  const activeCourses = courses.filter((c) => c.status !== 'completed' && c.status !== 'attested');
  const completedCourses = courses.filter(
    (c) => c.status === 'completed' || c.status === 'attested',
  );

  const displayedCourses = activeTab === 'active' ? activeCourses : completedCourses;

  return (
    <section className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
      {/* Tab Bar */}
      <div className="flex border-b border-[#e2e8f0] bg-[#f8fafc]">
        {TABS.map((tab) => {
          const count = tab.key === 'active' ? activeCourses.length : completedCourses.length;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              className={[
                'flex items-center gap-2 border-b-2 px-6 py-3.5 text-sm font-semibold transition-all',
                isActive
                  ? 'border-[#4730f7] bg-white text-[#4730f7]'
                  : 'border-transparent text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#1e293b]',
              ].join(' ')}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              <span
                className={[
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] px-1.5 text-[11px] font-bold',
                  isActive ? 'bg-[#eef2ff] text-[#4730f7]' : 'bg-[#e2e8f0] text-[#475569]',
                ].join(' ')}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col">
        {displayedCourses.length > 0 ? (
          displayedCourses.map((course) => {
            const isCompleted = course.status === 'completed' || course.status === 'attested';
            const isStarted = course.progress > 0;
            const isFailed = course.status === 'failed';
            const isLocked = course.status === 'locked';

            // Button Logic
            let buttonText = 'Start Course';
            let onClick = () => handleStartClick(course.id);

            if (isLocked) {
              buttonText = 'Locked';
              onClick = () => {};
            } else if (isCompleted) {
              buttonText = 'View Result';
              onClick = () => handleViewResultClick(course.id);
            } else if (isStarted && !isFailed) {
              buttonText = 'Continue';
            } else if (isFailed) {
              buttonText = 'Retry';
            }

            return (
              <div
                key={course.id + '-' + course.enrollmentId}
                className="flex items-center justify-between border-b border-dashed border-[#e2e8f0] px-8 py-6 transition-all last:border-b-0 hover:bg-[#f8fafc] max-md:flex-col max-md:items-start max-md:gap-4 max-md:px-4 max-md:py-5"
              >
                <div className="flex items-center gap-5 max-md:w-full max-md:gap-3">
                  <div className="flex size-12 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#1e293b] text-white max-md:size-10 max-md:rounded-lg">
                    <Layers className="size-6" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-base font-semibold text-[#1a202c] max-md:text-sm">
                      {course.retakeOf ? (
                        <span className="mr-2 font-semibold text-[#E53E3E]">Retake:</span>
                      ) : null}
                      {course.title}
                    </h3>
                    <p className="text-sm text-[#718096]">
                      {course.category ? formatCategory(course.category) : 'General'}
                    </p>
                    <DeadlineMeta deadline={course.deadline} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 max-md:w-full">
                  <button
                    className={[
                      'min-w-[120px] rounded-md px-5 py-2.5 text-center text-sm font-semibold transition-colors max-md:w-full',
                      isLocked
                        ? 'cursor-not-allowed bg-[#CBD5E1] text-[#475569] opacity-50'
                        : 'bg-[#4730f7] text-white hover:bg-[#3720e3]',
                    ].join(' ')}
                    disabled={isLocked}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClick();
                    }}
                  >
                    {buttonText}
                  </button>
                  {isLocked && (
                    <span className="text-[10px] text-[#EF4444]">Waiting for admin retake</span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-[60px] text-[#94a3b8]">
            <p className="text-sm">
              {activeTab === 'active'
                ? 'No active courses. All your courses are completed!'
                : 'No completed courses yet.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
