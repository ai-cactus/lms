'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import ShareCourseModal from '@/components/dashboard/training/ShareCourseModal';
import { offerCourseToOrg } from '@/app/actions/offering';
import type { VideoCourseAvailabilityRow } from '@/app/actions/offering';
import { logger } from '@/lib/logger';
import { Loader2, ChevronRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AvailableCoursesTableProps {
  courses: VideoCourseAvailabilityRow[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AvailableCoursesTable({ courses }: AvailableCoursesTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareModal, setShareModal] = useState<{ isOpen: boolean; courseId: string | null }>({
    isOpen: false,
    courseId: null,
  });

  // Show at most 5 rows
  const rows = courses.slice(0, 5);

  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary">No video courses available yet.</p>;
  }

  const handleOffer = (courseId: string) => {
    setError(null);
    setPendingId(courseId);
    startTransition(async () => {
      try {
        await offerCourseToOrg(courseId);
        router.refresh();
      } catch (err) {
        logger.error({ msg: '[available-courses] Failed to offer course to org', err });
        setError(err instanceof Error ? err.message : 'Failed to offer course. Please try again.');
      } finally {
        setPendingId(null);
      }
    });
  };

  const openShareModal = (courseId: string) => {
    setShareModal({ isOpen: true, courseId });
  };

  const closeShareModal = () => {
    setShareModal({ isOpen: false, courseId: null });
  };

  return (
    <section className="flex flex-col gap-3">
      {/* Section heading */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-[#1a202c]">Available Courses</h2>
        <p className="text-sm text-[#718096]">Global training you can offer to your organization</p>
      </div>

      {/* Error alert */}
      {error && (
        <Alert variant="error" className="mb-1">
          {error}
        </Alert>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="hidden md:table-cell">Duration</TableHead>
              <TableHead className="hidden md:table-cell">Questions</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((course) => {
              const isThisPending = isPending && pendingId === course.id;
              return (
                <TableRow key={course.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-foreground">{course.title}</span>
                      {/* Duration visible on mobile only */}
                      <span className="text-xs text-text-secondary md:hidden">
                        {formatDuration(course.durationSeconds)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-text-secondary text-sm">
                    {formatDuration(course.durationSeconds)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-text-secondary text-sm">
                    {course.questionCount > 0 ? course.questionCount : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {course.isOffered ? (
                        <>
                          <Badge variant="secondary">Offered</Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openShareModal(course.id)}
                          >
                            Assign staff
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleOffer(course.id)}
                          disabled={isThisPending || (isPending && pendingId !== null)}
                        >
                          {isThisPending ? (
                            <>
                              <Loader2
                                className="mr-1.5 size-3.5 animate-spin"
                                aria-hidden="true"
                              />
                              Offering…
                            </>
                          ) : (
                            'Offer to org'
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* View all → deep-link to the "Available Video Courses" tab */}
      <div className="flex justify-end">
        <Link
          href="/dashboard/courses?tab=available"
          className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          View all
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Assign staff modal */}
      {shareModal.courseId && (
        <ShareCourseModal
          isOpen={shareModal.isOpen}
          onClose={closeShareModal}
          courseId={shareModal.courseId}
        />
      )}
    </section>
  );
}
