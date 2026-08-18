'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, CirclePlay, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DatePicker from '@/components/ui/DatePicker';
import { getCourses } from '@/app/actions/course';
import { assignCoursesToStaffMember } from '@/app/actions/staff';
import type { AssignCoursesToStaffResult } from '@/app/actions/staff';
import type { CourseWithStats } from '@/types/course';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

interface AssignCoursesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Global `User` id — NOT an `OrganizationUser` membership id. */
  staffUserId: string;
  staffName: string;
  /** Rendered disabled rather than hidden, so the admin can see why. */
  enrolledCourseIds: string[];
  onSuccess?: () => void;
}

type Step = 'select' | 'deadline' | 'success';
type CourseTab = 'video' | 'reading';

/** The design's two tabs map onto the platform's two course types. */
const COURSE_TYPE_BY_TAB: Record<CourseTab, string> = {
  video: 'video',
  reading: 'text',
};

const TABS: { id: CourseTab; label: string; icon: typeof CirclePlay }[] = [
  { id: 'video', label: 'Video Courses', icon: CirclePlay },
  { id: 'reading', label: 'Reading Courses', icon: BookOpen },
];

const SEARCH_PLACEHOLDER: Record<CourseTab, string> = {
  video: 'Search video courses…',
  reading: 'Search reading courses…',
};

const DEADLINE_PRESETS = [
  { label: '30 days', months: 0, days: 30 },
  { label: '6 months', months: 6, days: 0 },
  { label: '1 year', months: 12, days: 0 },
];

/** Local calendar date as `YYYY-MM-DD`, the format DatePicker reads and writes. */
function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function offsetFromToday(preset: { months: number; days: number }): string {
  const date = new Date();
  date.setMonth(date.getMonth() + preset.months);
  date.setDate(date.getDate() + preset.days);
  return toDateInputValue(date);
}

function pluralCourses(count: number): string {
  return count === 1 ? 'course' : 'courses';
}

/**
 * Staff-profile "Assign Course" flow: pick one or more courses → set an optional
 * shared completion deadline → confirmation. The server assigns what it can and
 * reports back what was newly assigned, already assigned and failed; a batch that
 * newly assigns nothing sends no email, so it never reaches the success step.
 */
export default function AssignCoursesModal({
  isOpen,
  onClose,
  staffUserId,
  staffName,
  enrolledCourseIds,
  onSuccess,
}: AssignCoursesModalProps) {
  const [step, setStep] = useState<Step>('select');
  const [tab, setTab] = useState<CourseTab>('video');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [courses, setCourses] = useState<CourseWithStats[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<AssignCoursesToStaffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setStep('select');
    setTab('video');
    setSearch('');
    setSelectedIds([]);
    setDueDate('');
    setResult(null);
    setError(null);

    let cancelled = false;
    setIsLoadingCourses(true);
    getCourses()
      .then((data) => {
        if (!cancelled) setCourses(data);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error({ msg: '[staff] Failed to load courses for assignment', err });
        setError('Could not load your courses. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCourses(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const enrolledIdSet = useMemo(() => new Set(enrolledCourseIds), [enrolledCourseIds]);

  const visibleCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return courses.filter((course) => {
      if (course.type !== COURSE_TYPE_BY_TAB[tab]) return false;
      if (!query) return true;
      return (
        course.title.toLowerCase().includes(query) ||
        (course.description ?? '').toLowerCase().includes(query)
      );
    });
  }, [courses, tab, search]);

  const toggleCourse = useCallback((courseId: string) => {
    setSelectedIds((prev) =>
      prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId],
    );
  }, []);

  const selectedCount = selectedIds.length;
  const assignLabel =
    selectedCount > 1 ? `Assign ${selectedCount} ${pluralCourses(selectedCount)}` : 'Assign Course';

  // The server rejects a deadline that is not in the future, so today is not offerable.
  const earliestDueDate = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }, []);

  const handleAssign = async () => {
    if (selectedCount === 0) return;

    setIsSubmitting(true);
    setResult(null);
    setError(null);

    try {
      const res = await assignCoursesToStaffMember(staffUserId, selectedIds, {
        dueAt: dueDate || null,
      });
      setResult(res);

      // Nothing newly assigned means no email was sent — stay put and say so
      // rather than showing a success screen that would misrepresent the outcome.
      if (res.assigned.length > 0) setStep('success');
    } catch (err) {
      logger.error({ msg: '[staff] Failed to assign courses', err, staffUserId });
      setError(err instanceof Error ? err.message : 'Failed to assign the selected courses.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDone = () => {
    onSuccess?.();
    onClose();
  };

  const assignedCount = result?.assigned.length ?? 0;
  const alreadyAssignedCount = result?.alreadyAssigned.length ?? 0;
  const failedCount = result?.failed.length ?? 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent
        className={cn(
          'max-h-[90vh] overflow-y-auto',
          step === 'success' ? 'sm:max-w-[428px]' : 'sm:max-w-[614px]',
        )}
        onInteractOutside={(e) => {
          // The deadline DatePicker portals its calendar to <body>, so picking a
          // day reads as an "outside" interaction — keep the modal open.
          const target = e.target as HTMLElement | null;
          if (target?.closest('#date-picker-popover')) e.preventDefault();
        }}
      >
        {step === 'select' && (
          <div className="flex min-w-0 flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Assign Courses</DialogTitle>
              <DialogDescription>
                Choose the courses {staffName} will be assigned to.
              </DialogDescription>
            </DialogHeader>

            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as CourseTab)}
              className="gap-4"
            >
              <TabsList className="grid h-11 w-full grid-cols-2">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <TabsTrigger key={id} value={id}>
                    <Icon aria-hidden="true" />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={SEARCH_PLACEHOLDER[tab]}
                aria-label={SEARCH_PLACEHOLDER[tab]}
                className="h-11"
                startIcon={<Search aria-hidden="true" />}
              />

              {TABS.map(({ id }) => (
                <TabsContent key={id} value={id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">Select course</span>
                    {selectedCount > 0 && (
                      <Badge className="bg-primary/10 text-primary">{selectedCount} selected</Badge>
                    )}
                  </div>

                  <div className="max-h-[212px] overflow-y-auto rounded-[10px] border border-border">
                    {isLoadingCourses ? (
                      <p className="px-4 py-8 text-center text-sm text-text-secondary">
                        Loading courses…
                      </p>
                    ) : visibleCourses.length === 0 ? (
                      <p className="px-4 py-8 text-center text-sm text-text-secondary">
                        No {id === 'video' ? 'video' : 'reading'} courses found.
                      </p>
                    ) : (
                      visibleCourses.map((course) => {
                        const isEnrolled = enrolledIdSet.has(course.id);
                        const isSelected = selectedIds.includes(course.id);
                        return (
                          <label
                            key={course.id}
                            className={cn(
                              'flex items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0',
                              isEnrolled && 'cursor-not-allowed opacity-60',
                              !isEnrolled && 'cursor-pointer',
                              !isEnrolled && isSelected && 'bg-primary/5',
                              !isEnrolled && !isSelected && 'hover:bg-background-secondary',
                            )}
                          >
                            <Checkbox
                              checked={isSelected}
                              disabled={isEnrolled}
                              onCheckedChange={() => toggleCourse(course.id)}
                              aria-label={course.title}
                            />
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
                              {id === 'video' ? (
                                <CirclePlay className="size-[18px]" aria-hidden="true" />
                              ) : (
                                <BookOpen className="size-[18px]" aria-hidden="true" />
                              )}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span
                                className={cn(
                                  'truncate text-sm font-medium',
                                  isSelected && !isEnrolled ? 'text-primary' : 'text-foreground',
                                )}
                              >
                                {course.title}
                              </span>
                              <span className="truncate text-xs text-text-secondary">
                                {course.description ?? 'No description provided.'}
                              </span>
                            </span>
                            {isEnrolled && (
                              <Badge variant="secondary" className="shrink-0 text-text-secondary">
                                Assigned
                              </Badge>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                </TabsContent>
              ))}
            </Tabs>

            {error && <Alert variant="error">{error}</Alert>}

            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => setStep('deadline')}
                disabled={selectedCount === 0}
              >
                {assignLabel}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'deadline' && (
          <div className="flex min-w-0 flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Set Completion Deadline</DialogTitle>
              <DialogDescription>
                Set a deadline for {staffName} to complete the selected{' '}
                {pluralCourses(selectedCount)}.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Completion deadline (optional)
              </span>
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                placeholder="Select due date"
                label="Completion deadline"
                minDate={earliestDueDate}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">Suggested:</span>
                {DEADLINE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setDueDate(offsetFromToday(preset))}
                    className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            {result && assignedCount === 0 && (
              <Alert
                variant={result.error || failedCount > 0 ? 'error' : 'warning'}
                title="No new courses were assigned"
              >
                {result.error ??
                  (failedCount > 0
                    ? `${failedCount} ${pluralCourses(failedCount)} could not be assigned. No notification was sent to ${staffName}.`
                    : `${staffName} is already assigned to the selected ${pluralCourses(
                        alreadyAssignedCount,
                      )}, so no notification was sent.`)}
              </Alert>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setStep('select')}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button type="button" onClick={handleAssign} loading={isSubmitting}>
                {assignLabel}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'success' && (
          <div className="flex min-w-0 flex-col items-center gap-4 py-2 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-success text-white ring-8 ring-success/15">
              <Check className="size-7" aria-hidden="true" />
            </span>
            <DialogHeader className="items-center gap-2 text-center sm:text-center">
              <DialogTitle className="text-xl">Courses Assigned Successfully</DialogTitle>
              <DialogDescription>
                <span className="font-medium text-primary">{staffName}</span> has been assigned to{' '}
                {assignedCount} {pluralCourses(assignedCount)}. They can now access the{' '}
                {pluralCourses(assignedCount)} and complete them before the set deadline.
              </DialogDescription>
            </DialogHeader>

            {alreadyAssignedCount > 0 && (
              <Alert variant="warning" className="text-left">
                {alreadyAssignedCount} selected {pluralCourses(alreadyAssignedCount)}{' '}
                {alreadyAssignedCount === 1 ? 'was' : 'were'} already assigned and{' '}
                {alreadyAssignedCount === 1 ? 'was' : 'were'} skipped.
              </Alert>
            )}

            {failedCount > 0 && (
              <Alert variant="error" className="text-left">
                {failedCount} selected {pluralCourses(failedCount)} could not be assigned.
              </Alert>
            )}

            <Button type="button" onClick={handleDone} className="mt-2 w-full">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
