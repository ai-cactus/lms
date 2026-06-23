'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, FileText, ShieldCheck } from 'lucide-react';
import type { VideoCourseAvailabilityRow } from '@/app/actions/offering';

// All global video courses share the same delivery format and deliverables, so
// these two meta items are static copy (confirmed with product).
const DELIVERY_FORMAT = 'Video lessons & Practical exercises';
const DELIVERABLES = 'Training, Quiz & Certificate';

/** Human-friendly duration: "45 min", "1 hour", "2.5 hours". Null when unknown. */
function formatCourseDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function CourseThumbnail({ courseId, hasPreview }: { courseId: string; hasPreview: boolean }) {
  return (
    <div className="relative aspect-[3/2] w-full shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-emerald-700 via-teal-600 to-amber-500 sm:w-[200px]">
      {hasPreview && (
        // Loading just the metadata renders the first frame as a still poster —
        // no autoplay, no bytes streamed beyond the header. `#t=0.1` nudges past
        // a possible black 0s frame.
        <video
          src={`/api/courses/${courseId}/preview-video#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

interface VideoCourseCardProps {
  course: VideoCourseAvailabilityRow;
}

export default function VideoCourseCard({ course }: VideoCourseCardProps) {
  const duration = formatCourseDuration(course.durationSeconds);
  const href = `/dashboard/training/courses/${course.id}`;

  return (
    <Link
      href={href}
      aria-label={`View ${course.title}`}
      className="group flex flex-col gap-4 rounded-xl border border-border bg-white p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:flex-row"
    >
      <CourseThumbnail courseId={course.id} hasPreview={course.hasPreview} />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          {course.category ? (
            <span className="inline-flex w-fit items-center rounded-full bg-pink-500 px-3 py-1 text-xs font-semibold text-white">
              {course.category}
            </span>
          ) : (
            <span />
          )}
          <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary group-hover:underline">
            View
            <ChevronRight className="size-4" aria-hidden="true" />
          </span>
        </div>

        <h3 className="text-base font-bold text-[#1a202c]">{course.title}</h3>

        {course.description && (
          <p className="line-clamp-2 text-sm text-text-secondary">{course.description}</p>
        )}

        {duration && <p className="text-sm text-text-secondary">{duration}</p>}

        <div className="mt-0.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <FileText className="size-3.5" aria-hidden="true" />
            {DELIVERY_FORMAT}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            {DELIVERABLES}
          </span>
        </div>
      </div>
    </Link>
  );
}
