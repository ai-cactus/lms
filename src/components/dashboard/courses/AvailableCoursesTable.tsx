'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { VideoCourseAvailabilityRow } from '@/app/actions/offering';
import VideoCourseCard from './VideoCourseCard';

interface AvailableCoursesTableProps {
  courses: VideoCourseAvailabilityRow[];
}

export default function AvailableCoursesTable({ courses }: AvailableCoursesTableProps) {
  const rows = courses.slice(0, 5);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-[#1a202c]">Available Courses</h2>
        <p className="text-sm text-[#718096]">
          Global video training available to your organization
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-text-secondary">No video courses available yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((course) => (
            <VideoCourseCard key={course.id} course={course} />
          ))}
        </div>
      )}

      {courses.length > 0 && (
        <div className="flex justify-end">
          <Link
            href="/dashboard/courses?tab=available"
            className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            View all
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}
