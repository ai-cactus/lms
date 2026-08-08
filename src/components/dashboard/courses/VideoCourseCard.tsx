'use client';

import React, { useState } from 'react';
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

function CourseThumbnail({ courseId, hasPoster }: { courseId: string; hasPoster: boolean }) {
  const [posterFailed, setPosterFailed] = useState(false);

  return (
    // The gradient is the backdrop, not a placeholder to swap out: it shows
    // through whenever there is no poster to paint over it — no poster on the
    // row, or the image failed to load.
    <div className="relative aspect-[3/2] w-full shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-emerald-700 via-teal-600 to-amber-500 sm:w-[200px]">
      {hasPoster && !posterFailed && (
        /* eslint-disable-next-line @next/next/no-img-element -- next/image is
           unusable here: the optimizer refetches the source server-side without
           the viewer's cookies, so it cannot authenticate against this route and
           would render every thumbnail as a 401. */
        <img
          src={`/api/courses/${courseId}/preview-poster`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setPosterFailed(true)}
          className="h-full w-full object-cover"
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
      <CourseThumbnail courseId={course.id} hasPoster={course.hasPoster} />

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
