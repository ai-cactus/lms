'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  Play,
  PlayCircle,
} from 'lucide-react';

import { CourseWithRelations, EnrollmentWithRelations } from '@/types/course';

interface CoursePreviewProps {
  course: CourseWithRelations;
  mode?: 'admin' | 'worker';
  user?: { name?: string | null; email?: string | null }; // Current user details
  enrollment?: EnrollmentWithRelations | null; // Enrollment details
}

import { startCourse } from '@/app/actions/course';
import { requestCourseRetry } from '@/app/actions/enrollment';
import { logger } from '@/lib/logger';
import { RichTextContent } from '@/components/courses/RichTextContent';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "m:ss" from raw seconds, or null when unknown. */
function formatClock(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── Preview video player ──────────────────────────────────────────────────────

/**
 * Plays the course preview video via the same-origin proxy. Shows the first
 * frame with a centered play button until the viewer starts it.
 */
function PreviewVideoPlayer({ courseId }: { courseId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        src={`/api/courses/${courseId}/preview-video#t=0.1`}
        className="h-full w-full object-contain"
        preload="metadata"
        playsInline
        controls={started}
        onPlay={() => setStarted(true)}
        onPause={() => setStarted(true)}
      />
      {!started && (
        <button
          type="button"
          aria-label="Play preview"
          onClick={() => {
            void videoRef.current?.play();
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors hover:bg-black/25"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-white/90 shadow-lg">
            <Play className="ml-1 size-7 text-[#1a202c]" fill="currentColor" aria-hidden="true" />
          </span>
        </button>
      )}
    </div>
  );
}

// ── Worker action button (unchanged behavior) ─────────────────────────────────

function WorkerStartButton({
  courseId,
  enrollment,
}: {
  courseId: string;
  enrollment: EnrollmentWithRelations | null | undefined;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const isStarted = (enrollment?.progress || 0) > 0 || enrollment?.status === 'in_progress';
  const isCompleted = enrollment?.status === 'completed' || enrollment?.status === 'attested';
  const isFailed = enrollment?.status === 'failed';
  const isRetryRequested = enrollment?.status === 'retry_requested';

  let buttonText = 'Start Course';
  if (loading) buttonText = 'Processing...';
  else if (isCompleted) buttonText = 'Review Course';
  else if (isFailed) buttonText = 'Request Retry';
  else if (isRetryRequested) buttonText = 'Retry Requested';
  else if (isStarted) buttonText = 'Continue Course';

  const handleClick = async () => {
    if (isCompleted) {
      router.push(`/learn/${courseId}`);
      return;
    }
    if (isRetryRequested) return;

    try {
      setLoading(true);
      if (isFailed && enrollment?.id) {
        await requestCourseRetry(enrollment.id);
        router.refresh();
        setLoading(false);
        return;
      }
      await startCourse(courseId);
      router.push(`/learn/${courseId}`);
    } catch (error) {
      logger.error({ msg: 'Failed to start/retry course:', err: error });
      if (!isFailed) {
        router.push(`/learn/${courseId}`);
      }
      setLoading(false);
    }
  };

  return (
    <Button
      className="text-base"
      size="lg"
      onClick={handleClick}
      disabled={loading || isRetryRequested}
      variant={isFailed ? 'outline' : 'default'}
    >
      {buttonText}
    </Button>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CoursePreview({
  course,
  mode = 'admin',
  user,
  enrollment,
}: CoursePreviewProps) {
  const [showAllModules, setShowAllModules] = useState(false);
  // Course Contents accordion — first chapter open by default.
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>({});

  // Video courses report "watch" time from the video length; text courses "read".
  const videoLesson = course.lessons?.find((l) => l.videoStorageUri);
  const isVideoCourse = course.type === 'video' || Boolean(videoLesson);
  const videoSeconds = videoLesson?.videoDurationSeconds ?? null;
  const watchMinutes =
    videoSeconds != null && videoSeconds > 0
      ? Math.max(1, Math.round(videoSeconds / 60))
      : (course.duration ?? null);

  const approver = course.creator?.profile?.fullName ?? course.creator?.email ?? null;
  const passingScore = course.quiz?.passingScore ?? null;
  const skillLevel = course.skillLevel ?? null;
  const objectives = course.objectives ?? [];

  // "Included Modules" = the course's video lessons (flat list).
  const lessons = course.lessons ?? [];
  const visibleLessons = showAllModules ? lessons : lessons.slice(0, 4);

  // "Course Contents" = chapters (modules) with their lectures.
  const chapters = course.modules ?? [];
  const quiz = course.quiz;
  const hasCourseContents = chapters.length > 0 || Boolean(quiz);

  const isChapterOpen = (id: string, index: number) => openChapters[id] ?? index === 0; // first chapter defaults open

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      {/* Dark Header */}
      <div className="relative -m-10 mb-10 bg-[#1a202c] px-6 py-10 text-white md:px-[60px]">
        <div className="relative mx-auto max-w-[1200px]">
          <Link
            href={`/dashboard/training/courses/${course.id}`}
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#a0aec0] no-underline hover:text-white"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to course
          </Link>

          <h1 className="mb-3 text-3xl font-bold md:text-[36px]">{course.title}</h1>
          {course.description && (
            <p className="mb-4 text-base text-[#cbd5e0]">{course.description}</p>
          )}

          {approver && !isVideoCourse && (
            <div className="mb-6 inline-flex items-center gap-2 text-sm text-white">
              <CircleCheck className="size-4 text-[#48bb78]" aria-hidden="true" />
              <span>
                <strong>Approved by: {approver}</strong> (Admin)
              </span>
            </div>
          )}

          <div className="flex flex-col gap-6 border-t border-dashed border-[#4a5568] pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-[#c6f6d5] px-3 py-1 text-[13px] font-semibold text-[#22543d]">
                {course.status === 'published' ? 'Active' : 'Inactive'}
              </span>
              {watchMinutes != null && (
                <span className="flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[13px] text-white/85">
                  <Clock className="mr-1.5 size-3.5" aria-hidden="true" />
                  {watchMinutes} min {isVideoCourse ? 'watch' : 'read'}
                </span>
              )}
              {passingScore != null && (
                <span className="flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[13px] text-white/85">
                  <Calendar className="mr-1.5 size-3.5" aria-hidden="true" />
                  Pass mark: {passingScore}%
                </span>
              )}
            </div>

            <div className="shrink-0">
              {mode === 'worker' ? (
                <WorkerStartButton courseId={course.id} enrollment={enrollment} />
              ) : (
                <Link href={`/learn/${course.id}`}>
                  <Button className="text-base" size="lg">
                    View Course
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-[1200px]">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          {/* Left column */}
          <div className="flex flex-col gap-8">
            {course.previewVideoStorageUri && <PreviewVideoPlayer courseId={course.id} />}

            {/* Course Overview */}
            {(course.overview || course.description || objectives.length > 0) && (
              <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
                {(course.overview || course.description) && (
                  <>
                    <h2 className="mb-4 text-2xl font-bold text-[#1a202c]">Course Overview</h2>
                    <RichTextContent html={course.overview || course.description || ''} />
                  </>
                )}

                {objectives.length > 0 && (
                  <>
                    <h3 className="mt-8 mb-4 text-xl font-bold text-[#1a202c]">
                      What You&apos;ll Learn
                    </h3>
                    <ul className="flex flex-col gap-3">
                      {objectives.map((objective, index) => (
                        <li key={index} className="flex items-start gap-3 text-[#4a5568]">
                          <Check
                            className="mt-0.5 size-5 shrink-0 text-[#48bb78]"
                            aria-hidden="true"
                          />
                          <span>{objective}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {/* Course Contents */}
            {hasCourseContents && (
              <div className="flex flex-col gap-3">
                <h2 className="text-2xl font-bold text-[#1a202c]">Course Contents</h2>

                {chapters.map((chapter, index) => {
                  const open = isChapterOpen(chapter.id, index);
                  const totalSeconds = chapter.lessons.reduce(
                    (sum, l) => sum + (l.videoDurationSeconds ?? 0),
                    0,
                  );
                  const minutes = totalSeconds > 0 ? Math.max(1, Math.round(totalSeconds / 60)) : 0;
                  return (
                    <div
                      key={chapter.id}
                      className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 bg-[#f7fafc] px-5 py-4 text-left"
                        onClick={() =>
                          setOpenChapters((prev) => ({ ...prev, [chapter.id]: !open }))
                        }
                      >
                        <div>
                          <p className="font-bold text-[#1a202c]">{chapter.title}</p>
                          <p className="mt-0.5 text-xs text-[#718096]">
                            {pluralize(chapter.lessons.length, 'Lecture')}
                            {minutes > 0 ? ` • ${minutes} mins` : ''}
                          </p>
                        </div>
                        <ChevronDown
                          className={`size-5 shrink-0 text-[#718096] transition-transform ${open ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                      {open && chapter.lessons.length > 0 && (
                        <ul>
                          {chapter.lessons.map((lesson) => {
                            const clock = formatClock(lesson.videoDurationSeconds);
                            return (
                              <li
                                key={lesson.id}
                                className="flex items-center justify-between border-t border-[#edf2f7] px-5 py-3 text-sm"
                              >
                                <span className="flex items-center gap-2.5 text-[#2d3748]">
                                  <PlayCircle
                                    className="size-4 text-[#a0aec0]"
                                    aria-hidden="true"
                                  />
                                  {lesson.title}
                                </span>
                                {clock && <span className="text-[#a0aec0]">{clock}</span>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}

                {quiz && (
                  <div className="rounded-xl border border-[#e2e8f0] bg-[#f7fafc] px-5 py-4">
                    <p className="font-bold text-[#1a202c]">{quiz.title || 'Quiz'}</p>
                    <p className="mt-0.5 text-xs text-[#718096]">
                      {pluralize(quiz.questions?.length ?? 0, 'Question')}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right column (sidebar) */}
          <div className="flex flex-col gap-6">
            {/* Attestation Status Card (worker, attested) */}
            {enrollment?.status === 'attested' && (
              <div className="rounded-lg border border-[#E9D8FD] bg-[#FAF5FF] p-6">
                <h3 className="mb-4 text-lg font-bold text-[#1a202c]">Attestation status</h3>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E2E8F0] text-base font-semibold text-[#4A5568]">
                    {(user?.name?.[0] || 'U').toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#1A202C]">{user?.name || 'User'}</span>
                      <span className="rounded bg-[#E2E8F0] px-1.5 py-0.5 text-[11px]">You</span>
                    </div>
                    <div className="text-[13px] text-slate-500">{user?.email}</div>
                  </div>
                </div>
                <div className="mb-4 text-[13px] text-slate-500">
                  Course: &quot;{course.title}&quot;
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 rounded-xl bg-[#DEF7EC] px-2.5 py-1 text-xs font-semibold text-[#03543F]">
                    Signed
                    <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                </div>
              </div>
            )}

            {/* Course Details */}
            {(skillLevel || watchMinutes != null) && (
              <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
                <h3 className="mb-5 text-lg font-bold text-[#1a202c]">Course Details</h3>
                <div className="flex flex-col gap-4 text-sm">
                  {skillLevel && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2 text-[#718096]">
                        <BarChart3 className="size-4 text-slate-400" aria-hidden="true" />
                        Skill Level
                      </span>
                      <span className="font-semibold capitalize text-[#2d3748]">{skillLevel}</span>
                    </div>
                  )}
                  {watchMinutes != null && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2 text-[#718096]">
                        <Clock className="size-4 text-slate-400" aria-hidden="true" />
                        Total Duration
                      </span>
                      <span className="font-semibold text-[#2d3748]">{watchMinutes} mins</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-2 text-[#718096]">
                      <Calendar className="size-4 text-slate-400" aria-hidden="true" />
                      Last Updated
                    </span>
                    <span className="font-semibold text-[#2d3748]">
                      {new Date(course.updatedAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Included Modules */}
            {lessons.length > 0 && (
              <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-[#1a202c]">
                    Included Modules ({lessons.length})
                  </h3>
                  {lessons.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setShowAllModules((v) => !v)}
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      {showAllModules ? 'Show less' : 'View all'}
                    </button>
                  )}
                </div>
                <ul className="flex flex-col gap-4">
                  {visibleLessons.map((lesson) => {
                    const clock = formatClock(lesson.videoDurationSeconds);
                    return (
                      <li key={lesson.id} className="flex items-start gap-3">
                        <CircleCheck
                          className="mt-0.5 size-5 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[#1a202c]">{lesson.title}</p>
                          <p className="text-xs text-[#718096]">
                            {isVideoCourse ? 'Video' : 'Text'}
                            {clock ? ` • ${clock}` : ''}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
