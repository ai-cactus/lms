'use client';

import React, { useState, useMemo, useTransition } from 'react';
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
import { Input } from '@/components/ui/input';
import EmptyTableState from '@/components/ui/EmptyTableState';
import ShareCourseModal from '@/components/dashboard/training/ShareCourseModal';
import { offerCourseToOrg } from '@/app/actions/offering';
import type { VideoCourseAvailabilityRow } from '@/app/actions/offering';
import { logger } from '@/lib/logger';
import { Loader2, Search } from 'lucide-react';

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

interface AvailableCoursesClientProps {
  courses: VideoCourseAvailabilityRow[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AvailableCoursesClient({ courses }: AvailableCoursesClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [shareModal, setShareModal] = useState<{ isOpen: boolean; courseId: string | null }>({
    isOpen: false,
    courseId: null,
  });

  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return courses;
    const q = searchQuery.toLowerCase();
    return courses.filter((c) => c.title.toLowerCase().includes(q));
  }, [courses, searchQuery]);

  const handleOffer = (courseId: string) => {
    setError(null);
    setPendingId(courseId);
    startTransition(async () => {
      try {
        await offerCourseToOrg(courseId);
        router.refresh();
      } catch (err) {
        logger.error({ msg: '[available-courses-client] Failed to offer course to org', err });
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
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div>
          <div className="mb-2 text-sm text-[#718096]">Trainings / Courses</div>
          <h1 className="text-2xl font-bold text-[#1a202c]">Available Video Courses</h1>
        </div>
      </div>

      <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
        {/* Error alert */}
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}

        {/* Search */}
        <div className="mb-6 w-full sm:w-[380px]">
          <Input
            className="h-11"
            placeholder="Search video courses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            startIcon={<Search aria-hidden="true" />}
          />
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead className="w-[45%]">Title</TableHead>
              <TableHead className="hidden md:table-cell w-[15%]">Duration</TableHead>
              <TableHead className="hidden md:table-cell w-[15%]">Questions</TableHead>
              <TableHead className="text-right w-[25%]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCourses.length > 0 ? (
              filteredCourses.map((course) => {
                const isThisPending = isPending && pendingId === course.id;
                return (
                  <TableRow key={course.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">{course.title}</span>
                        {/* Duration visible on mobile only */}
                        <span className="text-xs text-muted-foreground md:hidden">
                          {formatDuration(course.durationSeconds)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                      {formatDuration(course.durationSeconds)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
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
              })
            ) : (
              <EmptyTableState
                message="No video courses available yet."
                subMessage={
                  searchQuery.trim()
                    ? 'Try adjusting your search.'
                    : 'Global video courses will appear here once published.'
                }
                colSpan={4}
                asTableRow
              />
            )}
          </TableBody>
        </Table>

        {/* Assign staff modal */}
        {shareModal.courseId && (
          <ShareCourseModal
            isOpen={shareModal.isOpen}
            onClose={closeShareModal}
            courseId={shareModal.courseId}
          />
        )}
      </div>
    </div>
  );
}
