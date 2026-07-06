'use client';

import React, { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Users, Search, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { RowActionsMenu } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateOffering, withdrawOffering } from '@/app/actions/offering';
import type { OfferedVideoCourseRow } from '@/app/actions/offering';
import { logger } from '@/lib/logger';

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

interface OfferedCoursesClientProps {
  courses: OfferedVideoCourseRow[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OfferedCoursesClient({ courses }: OfferedCoursesClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [editTarget, setEditTarget] = useState<OfferedVideoCourseRow | null>(null);

  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return courses;
    const q = searchQuery.toLowerCase();
    return courses.filter((c) => c.title.toLowerCase().includes(q));
  }, [courses, searchQuery]);

  const handleWithdraw = (course: OfferedVideoCourseRow) => {
    if (
      !confirm(
        `Withdraw "${course.title}" from your organization?\n\nStaff already assigned keep their progress, but the course will no longer appear here.`,
      )
    ) {
      return;
    }
    setError(null);
    setPendingId(course.offeringId);
    startTransition(async () => {
      try {
        await withdrawOffering(course.offeringId);
        router.refresh();
      } catch (err) {
        logger.error({
          msg: '[offered-courses] withdraw failed',
          err,
          offeringId: course.offeringId,
        });
        setError(err instanceof Error ? err.message : 'Failed to withdraw course.');
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <div className="mb-8">
        <div className="mb-2 text-sm text-text-secondary">Trainings / Courses</div>
        <h1 className="text-2xl font-bold text-foreground">Video Courses</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Global video courses your organization has offered to its staff.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background p-6">
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}

        <div className="mb-6 w-full sm:w-[380px]">
          <Input
            className="h-11"
            placeholder="Search video courses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            startIcon={<Search aria-hidden="true" />}
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead className="w-[40%]">Title</TableHead>
              <TableHead className="hidden md:table-cell">Duration</TableHead>
              <TableHead className="hidden md:table-cell">Questions</TableHead>
              <TableHead className="hidden md:table-cell">Enrolled</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCourses.length > 0 ? (
              filteredCourses.map((course) => {
                const isThisPending = isPending && pendingId === course.offeringId;
                return (
                  <TableRow key={course.offeringId}>
                    <TableCell>
                      <span className="font-medium text-foreground">{course.title}</span>
                      <span className="block text-xs text-text-secondary md:hidden">
                        {formatDuration(course.durationSeconds, course.durationMinutes)} &middot;{' '}
                        {course.questionCount} Qs &middot; {course.enrolledCount} enrolled
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-text-secondary">
                      {formatDuration(course.durationSeconds, course.durationMinutes)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-text-secondary">
                      {course.questionCount > 0 ? course.questionCount : '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-text-secondary">
                      {course.enrolledCount}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            router.push(`/dashboard/training/courses/${course.courseId}/assign`)
                          }
                        >
                          {isThisPending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <>
                              <Users className="mr-1.5 size-4" aria-hidden="true" />
                              Assign staff
                            </>
                          )}
                        </Button>
                        <RowActionsMenu
                          actions={[
                            {
                              label: 'Edit details',
                              icon: <Pencil className="size-4" />,
                              onSelect: () => setEditTarget(course),
                            },
                            {
                              label: 'Withdraw',
                              icon: <Trash2 className="size-4" />,
                              variant: 'destructive',
                              separatorBefore: true,
                              onSelect: () => handleWithdraw(course),
                            },
                          ]}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <EmptyTableState
                message="No video courses offered yet."
                subMessage={
                  searchQuery.trim()
                    ? 'Try adjusting your search.'
                    : 'Offer a course from the Available tab to make it available to your staff.'
                }
                colSpan={5}
                asTableRow
              />
            )}
          </TableBody>
        </Table>
      </div>

      <EditOfferingDialog
        course={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit (rebrand) dialog — updates the per-org overrides on the offering
// ---------------------------------------------------------------------------

function EditOfferingDialog({
  course,
  onClose,
  onSaved,
}: {
  course: OfferedVideoCourseRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customIntro, setCustomIntro] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed fields whenever a new course is opened.
  React.useEffect(() => {
    if (course) {
      setCustomTitle(course.customTitle ?? '');
      setCustomDescription(course.customDescription ?? '');
      setCustomIntro(course.customIntro ?? '');
      setError(null);
    }
  }, [course]);

  const handleSave = async () => {
    if (!course) return;
    setSaving(true);
    setError(null);
    try {
      await updateOffering(course.offeringId, {
        customTitle: customTitle.trim() || undefined,
        customDescription: customDescription.trim() || undefined,
        customIntro: customIntro.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      logger.error({ msg: '[offered-courses] update offering failed', err });
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={course !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit course details</DialogTitle>
          <DialogDescription>
            Rebrand this course for your organization. Leave a field blank to use the original
            {course ? ` ("${course.baseTitle}")` : ''}.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="error" className="mb-1">
            {error}
          </Alert>
        )}

        <div className="flex flex-col gap-4">
          <Field label="Custom title">
            <Input
              value={customTitle}
              placeholder={course?.baseTitle ?? 'Course title'}
              onChange={(e) => setCustomTitle(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Field label="Custom description">
            <textarea
              className="min-h-[72px] w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              value={customDescription}
              placeholder="Shown to staff in the course list (optional)"
              onChange={(e) => setCustomDescription(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Field label="Custom intro">
            <textarea
              className="min-h-[72px] w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              value={customIntro}
              placeholder="Intro message shown before the video (optional)"
              onChange={(e) => setCustomIntro(e.target.value)}
              disabled={saving}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={saving}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
