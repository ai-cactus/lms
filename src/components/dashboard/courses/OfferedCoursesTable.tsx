'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import ShareCourseModal from '@/components/dashboard/training/ShareCourseModal';
import type { OfferedVideoCourseRow } from '@/app/actions/offering';
import { Users, ChevronRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null, fallbackMinutes: number | null): string {
  if (seconds != null && seconds > 0) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  if (fallbackMinutes != null) return `${fallbackMinutes}m`;
  return '—';
}

interface OfferedCoursesTableProps {
  courses: OfferedVideoCourseRow[];
  maxItems?: number;
}

// ---------------------------------------------------------------------------
// Component — compact home-dashboard view of the org's offered video courses.
// (The full management view lives in OfferedCoursesClient, on the Courses page.)
// ---------------------------------------------------------------------------

export default function OfferedCoursesTable({ courses, maxItems = 5 }: OfferedCoursesTableProps) {
  const [shareModal, setShareModal] = useState<{ isOpen: boolean; courseId: string | null }>({
    isOpen: false,
    courseId: null,
  });

  // Nothing offered yet → render nothing (the Available table below handles discovery).
  if (courses.length === 0) return null;

  const rows = courses.slice(0, maxItems);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-[#1a202c]">Your Video Courses</h2>
          <p className="text-sm text-[#718096]">
            Global training you&apos;ve offered to your staff
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="hidden md:table-cell">Duration</TableHead>
              <TableHead className="hidden md:table-cell">Questions</TableHead>
              <TableHead className="hidden md:table-cell">Enrolled</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((course) => (
              <TableRow key={course.offeringId}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{course.title}</span>
                    <span className="text-xs text-text-secondary md:hidden">
                      {formatDuration(course.durationSeconds, course.durationMinutes)} &middot;{' '}
                      {course.enrolledCount} enrolled
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-text-secondary text-sm">
                  {formatDuration(course.durationSeconds, course.durationMinutes)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-text-secondary text-sm">
                  {course.questionCount > 0 ? course.questionCount : '—'}
                </TableCell>
                <TableCell className="hidden md:table-cell text-text-secondary text-sm">
                  {course.enrolledCount}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShareModal({ isOpen: true, courseId: course.courseId })}
                  >
                    <Users className="mr-1.5 size-4" aria-hidden="true" />
                    Assign staff
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* View all → deep-link to the "Offered Video Courses" tab */}
      <div className="flex justify-end">
        <Link
          href="/dashboard/courses?tab=video"
          className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          View all
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {shareModal.courseId && (
        <ShareCourseModal
          isOpen={shareModal.isOpen}
          onClose={() => setShareModal({ isOpen: false, courseId: null })}
          courseId={shareModal.courseId}
        />
      )}
    </section>
  );
}
