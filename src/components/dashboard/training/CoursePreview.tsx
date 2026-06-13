'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Clock, Calendar, BarChart3 } from 'lucide-react';

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

function WorkerStartButton({
  courseId,
  enrollment,
}: {
  courseId: string;
  enrollment: EnrollmentWithRelations | null | undefined;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Determine status
  const isStarted = (enrollment?.progress || 0) > 0 || enrollment?.status === 'in_progress';
  const isCompleted = enrollment?.status === 'completed' || enrollment?.status === 'attested';
  const isFailed = enrollment?.status === 'failed';
  const isRetryRequested = enrollment?.status === 'retry_requested';

  // Determine button text
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

    if (isRetryRequested) {
      return; // Do nothing
    }

    try {
      setLoading(true);

      if (isFailed && enrollment?.id) {
        // Handle retry request
        await requestCourseRetry(enrollment.id);
        // The server action revalidates the path, but we can also refresh
        router.refresh();
        setLoading(false);
        return;
      }

      await startCourse(courseId);
      router.push(`/learn/${courseId}`);
    } catch (error) {
      logger.error({ msg: 'Failed to start/retry course:', err: error });
      // Fallback navigation even if action fails (e.g. network)
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

export default function CoursePreview({
  course,
  mode = 'admin',
  user,
  enrollment,
}: CoursePreviewProps) {
  const [activeTab, setActiveTab] = useState('About');

  // Video courses show "watch" time from the video's length; text courses keep "read" time.
  const videoLesson = course.lessons?.find(
    (l) => (l as { videoStorageUri?: string | null }).videoStorageUri,
  );
  const isVideoCourse =
    (course as { type?: string | null }).type === 'video' || Boolean(videoLesson);
  const videoSeconds =
    (videoLesson as { videoDurationSeconds?: number | null } | undefined)?.videoDurationSeconds ??
    null;
  const watchMinutes =
    videoSeconds != null && videoSeconds > 0
      ? Math.max(1, Math.round(videoSeconds / 60))
      : (course.duration ?? null);

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      {/* Dark Header Section */}
      <div className="relative -m-10 mb-10 bg-[#1a202c] px-6 py-10 text-white md:px-[60px]">
        <div className="relative mx-auto max-w-[1200px]">
          <div className="mb-6 flex items-center gap-2 text-sm text-[#a0aec0]">
            <Link
              href={`/dashboard/training/courses/${course.id}`}
              className="text-[#a0aec0] no-underline hover:text-white"
            >
              Course
            </Link>
            <span className="text-[#718096]">/</span>
            <span className="font-medium text-white">{course.title}</span>
          </div>

          <h1 className="mb-3 text-3xl font-bold md:text-[36px]">{course.title}</h1>
          <p className="mb-4 text-base text-[#cbd5e0]">
            {course.description || 'Mandatory annual training aligned with CARF 1.H 4. a-b'}
          </p>
          <p className="mb-8 text-sm text-[#a0aec0]">
            By {course.creator?.profile?.fullName || course.creator?.email || 'Unknown Author'}
          </p>

          <div className="mb-8 flex w-full flex-wrap items-center gap-3 border-y border-dashed border-[#4a5568] py-4 lg:w-[70%]">
            <span className="rounded-full bg-[#c6f6d5] px-3 py-1 text-[13px] font-semibold text-[#22543d]">
              Active
            </span>
            <span className="flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[13px] text-white/85">
              <Clock className="mr-1.5 size-3.5" />
              {isVideoCourse
                ? `${watchMinutes ?? course.duration ?? 0} min watch`
                : `${course.duration || 10} min read`}
            </span>
            <span className="flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[13px] text-white/85">
              <Calendar className="mr-1.5 size-3.5" />
              Pass mark:{' '}
              {course.lessons?.find((l) => (l as { quiz?: { passingScore?: number } }).quiz)?.quiz
                ?.passingScore || 80}
              %
            </span>
          </div>

          <div className="lg:absolute lg:right-0 lg:bottom-10">
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

      {/* Main Content */}
      <div className="my-10 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left Column */}
        <div>
          <div className="h-full rounded-lg border border-[#e2e8f0] bg-white p-6">
            {/* Tabs */}
            <div className="mb-8 flex gap-8 border-b border-[#e2e8f0]">
              {['About'].map((tab) => (
                <button
                  key={tab}
                  className={`relative cursor-pointer py-3 text-base font-medium ${
                    activeTab === tab
                      ? "font-semibold text-primary after:absolute after:-bottom-px after:left-0 after:h-0.5 after:w-full after:bg-primary after:content-['']"
                      : 'text-[#718096]'
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'About' && (
              <div className="mt-8">
                <h2 className="mt-0 mb-6 text-2xl font-bold text-[#1a202c]">Course Overview</h2>
                <p className="mb-8 text-base leading-relaxed text-[#4a5568]">
                  {course.description || 'No description available.'}
                </p>

                {course.objectives && course.objectives.length > 0 && (
                  <>
                    <h3 className="mb-4 text-xl font-bold text-[#1a202c]">
                      What You&apos;ll Learn
                    </h3>
                    <ul className="ml-5 list-disc leading-[1.8] text-[#4a5568]">
                      {course.objectives.map((objective: string, index: number) => (
                        <li key={index}>{objective}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (Sidebar) */}
        <div>
          {/* Attestation Status Card */}
          {enrollment?.status === 'attested' && (
            <div className="mb-6 box-border rounded-lg border border-[#E9D8FD] bg-[#FAF5FF] p-6">
              <h3 className="mb-4 text-lg font-bold text-[#1a202c]">Attestation status</h3>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-[#E2E8F0] flex items-center justify-center text-base font-semibold text-[#4A5568]">
                  {(user?.name?.[0] || 'U').toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#1A202C]">{user?.name || 'User'}</span>
                    <span className="text-[11px] bg-[#E2E8F0] px-1.5 py-0.5 rounded">You</span>
                  </div>
                  <div className="text-[13px] text-slate-500">{user?.email}</div>
                </div>
              </div>

              <div className="text-[13px] text-slate-500 mb-4">
                Course: &quot;{course.title}&quot;
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 bg-[#DEF7EC] text-[#03543F] text-xs font-semibold px-2.5 py-1 rounded-xl">
                  Signed
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className="text-xs text-[#4C6EF5] cursor-pointer flex items-center">
                  View details
                  <ChevronRight className="ml-0.5 size-3" />
                </span>
              </div>
            </div>
          )}

          <div className="box-border h-full rounded-lg border border-[#e2e8f0] bg-white p-6">
            <h3 className="mb-6 text-lg font-bold text-[#1a202c]">Table of Content</h3>
            <div className="mb-6 flex flex-col gap-2">
              {course.lessons && course.lessons.length > 0 ? (
                course.lessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="flex cursor-pointer items-center justify-between border-b border-dashed border-[#edf2f7] py-2.5 text-sm text-[#2d3748] last:border-b-0"
                  >
                    <span className="font-medium text-[#2d3748]">{lesson.title}</span>
                    <span className="shrink-0 text-xs text-[#a0aec0]">
                      {(lesson as { duration?: number }).duration || 3} mins
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex cursor-pointer items-center justify-between py-2.5 text-sm italic text-slate-500">
                  No content available yet.
                </div>
              )}
            </div>

            <div className="my-6 h-px bg-[#e2e8f0]"></div>

            <div className="flex flex-col gap-3">
              {/* Skill Level - Try to get from quiz or hide */}
              {course.lessons?.some(
                (l) => (l as { quiz?: { difficulty?: string } }).quiz?.difficulty,
              ) && (
                <div className="flex justify-start gap-5 text-sm">
                  <span className="flex min-w-[140px] items-center gap-2 text-[#718096]">
                    <BarChart3 className="size-4 text-slate-400" />
                    Skill Level
                  </span>
                  <span className="font-semibold capitalize text-[#2d3748]">
                    {(
                      course.lessons.find(
                        (l) => (l as { quiz?: { difficulty?: string } }).quiz?.difficulty,
                      ) as { quiz?: { difficulty?: string } }
                    )?.quiz?.difficulty || 'General'}
                  </span>
                </div>
              )}

              <div className="flex justify-start gap-5 text-sm">
                <span className="flex min-w-[140px] items-center gap-2 text-[#718096]">
                  <Clock className="size-4 text-slate-400" />
                  Duration
                </span>
                <span className="font-semibold text-[#2d3748]">{course.duration || 0} mins</span>
              </div>
              <div className="flex justify-start gap-5 text-sm">
                <span className="flex min-w-[140px] items-center gap-2 text-[#718096]">
                  <Calendar className="size-4 text-slate-400" />
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
        </div>
      </div>
    </div>
  );
}
