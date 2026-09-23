'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
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
import { courseStatusBadge } from '@/lib/course/course-status-label';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';

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
        poster={`/api/courses/${courseId}/preview-poster`}
        className="h-full w-full object-contain"
        // With a poster painting the still frame, `preload="metadata"` would buy
        // nothing and cost an authenticated proxy request plus the MP4 header on
        // every page view. `none` means ZERO video bytes until the viewer
        // actually presses play.
        preload="none"
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
      const started = await startCourse(courseId);
      if (!started.success) {
        // Refused — the course was archived under the learner (Q-04). Re-render
        // instead of navigating: this page refuses an archived course too, so a
        // push would only land on the player's own refusal a step later.
        router.refresh();
        setLoading(false);
        return;
      }
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

  /**
   * D8/D10. `approvedBy` records who signed the publish off, but a null is a
   * permanent, reachable state — every course published before D8, any clean
   * draft that `publishCourseOnAssignment` publishes as a side effect of being
   * assigned, and every video course, which is uploaded system-wide and never
   * goes through approval at all. It falls back to the creator under a
   * DIFFERENT label, so the line never implies a review that did not happen.
   */
  const approver = course.approvedBy;
  const creator = course.creator;
  const attribution = approver
    ? {
        label: 'Approved by',
        name: approver.user.fullName || approver.user.email,
        role: getRoleDisplayName(approver.role),
      }
    : creator
      ? {
          label: 'Created by',
          name: creator.user.fullName || creator.user.email,
          role: getRoleDisplayName(creator.role),
        }
      : null;

  const statusBadge = courseStatusBadge(course.status, course.reviewRequired);

  // Text courses hang the quiz off the last lesson; video courses off the course.
  const passingScore =
    course.lessons?.find((l) => l.quiz)?.quiz?.passingScore ?? course.quiz?.passingScore ?? null;
  const skillLevel = course.skillLevel ?? null;
  const objectives = course.objectives ?? [];

  // "Table of Content" = the course's lessons (flat list).
  const lessons = course.lessons ?? [];
  const visibleLessons = showAllModules ? lessons : lessons.slice(0, 4);

  // "Course Contents" = chapters (modules) with their lectures.
  const chapters = course.modules ?? [];
  const quiz = course.quiz;
  const hasCourseContents = chapters.length > 0 || Boolean(quiz);

  const isChapterOpen = (id: string, index: number) => openChapters[id] ?? index === 0; // first chapter defaults open

  // The hero bleeds out of the layout's content padding, but only while this page
  // really is the top of the scroll area. A site-wide notice (the billing pause
  // banner) renders ahead of it in that same container, and an unconditional
  // upward pull would drag the opaque hero over the notice instead of sitting
  // below it.
  return (
    <div className="min-h-screen bg-[#f9fafb] first:-mt-10">
      <div className="relative -mx-10 mb-10 bg-[#1a202c] px-6 py-10 text-white md:px-[60px]">
        <div className="relative mx-auto max-w-[1200px]">
          {/*
            Breadcrumb, per the frame. The target is unchanged from the "Back to
            course" link it replaces, so worker-mode navigation is untouched.
          */}
          <p className="mb-6 flex items-center gap-1.5 text-sm font-medium">
            <Link
              href={
                mode === 'worker'
                  ? `/worker/courses/${course.id}`
                  : `/dashboard/training/courses/${course.id}`
              }
              className="text-[#a0aec0] no-underline hover:text-white"
            >
              Course
            </Link>
            <span className="text-[#a0aec0]">/</span>
            <span className="min-w-0 truncate text-white">{course.title}</span>
          </p>

          <h1 className="mb-3 text-3xl font-bold md:text-[36px]">{course.title}</h1>
          {course.description && (
            <p className="mb-4 text-base text-[#cbd5e0]">{course.description}</p>
          )}

          {/*
            One text run on purpose. The frame sets the role in a lighter weight
            than the name, but splitting it across elements would break the
            single-string assertion that both the unit suite and
            course-details-hero.spec.ts use to pin this line.
          */}
          {attribution && (
            <p className="mb-6 flex items-center gap-2 text-base font-semibold text-white">
              <CircleCheck className="size-5 shrink-0 text-[#48bb78]" aria-hidden="true" />
              <span>
                {attribution.label}: {attribution.name} ({attribution.role})
              </span>
            </p>
          )}

          <div className="flex flex-col gap-6 border-t border-dashed border-[#4a5568] pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              {/*
                The shared helper's classes are tuned for a light card and would
                vanish on this hero, so only its LABEL is reused. The green is
                reserved for the published state — it used to paint every status,
                which made a draft read as live.
              */}
              <span
                className={`rounded-full px-3 py-1 text-[13px] font-semibold ${
                  course.status === 'published'
                    ? 'bg-[#c6f6d5] text-[#22543d]'
                    : course.reviewRequired
                      ? 'bg-warning/25 text-warning'
                      : 'border border-white/15 bg-white/10 text-white/85'
                }`}
              >
                {statusBadge.label}
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

      <div className="mx-auto max-w-[1200px]">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-8">
            {course.previewVideoStorageUri && <PreviewVideoPlayer courseId={course.id} />}

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

            {(lessons.length > 0 || skillLevel || watchMinutes != null) && (
              <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-[#1a202c]">Table of Content</h3>
                  {lessons.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setShowAllModules((v) => !v)}
                      className="shrink-0 text-sm font-semibold text-primary hover:underline"
                    >
                      {showAllModules ? 'Show less' : 'View all'}
                    </button>
                  )}
                </div>

                {lessons.length > 0 && (
                  // Deliberately unhighlighted: a preview has no "current"
                  // lesson, so the frame's highlighted entry is placeholder.
                  <ol className="flex list-none flex-col gap-3 border-t border-[#e2e8f0] pt-4">
                    {visibleLessons.map((lesson) => {
                      const clock = formatClock(lesson.videoDurationSeconds);
                      return (
                        <li key={lesson.id} className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate text-base text-[#808897]">
                            {lesson.title}
                          </span>
                          {clock && (
                            <span className="shrink-0 text-xs text-[#a0aec0]">{clock}</span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}

                {/*
                  Always rendered: `updatedAt` is never null, so this block has
                  at least one honest row even when neither skill level nor a
                  duration estimate was recorded.
                */}
                <div className="mt-6 flex flex-col gap-4 border-t border-[#e2e8f0] pt-6 text-sm">
                  {skillLevel && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2 text-[#718096]">
                        <BarChart3 className="size-4 text-slate-400" aria-hidden="true" />
                        Skill Level
                      </span>
                      <span className="font-semibold text-[#2d3748] capitalize">{skillLevel}</span>
                    </div>
                  )}
                  {watchMinutes != null && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2 text-[#718096]">
                        <Clock className="size-4 text-slate-400" aria-hidden="true" />
                        Duration
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
          </div>
        </div>
      </div>
    </div>
  );
}
