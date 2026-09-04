'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Check, CirclePlay, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';
import DatePicker from '@/components/ui/DatePicker';
import { getAssignableCourses } from '@/app/actions/offering';
import { assignCoursesToStaffMember } from '@/app/actions/staff';
import type { CourseWithStats } from '@/types/course';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

interface AssignCoursesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** OrganizationUser (membership) id — NOT the global identity id. */
  staffOrgUserId: string;
  staffName: string;
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

/**
 * Staff-profile "Assign Course" flow: pick courses → set an optional shared
 * completion deadline → confirmation. Courses already assigned to the member are
 * still listed; the server skips them and reports only what it newly created.
 */
export default function AssignCoursesModal({
  isOpen,
  onClose,
  staffOrgUserId,
  staffName,
}: AssignCoursesModalProps) {
  const router = useRouter();

  const [step, setStep] = useState<Step>('select');
  const [tab, setTab] = useState<CourseTab>('video');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [courses, setCourses] = useState<CourseWithStats[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedCount, setAssignedCount] = useState(0);
  const [notificationFailed, setNotificationFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setStep('select');
    setTab('video');
    setSearch('');
    setSelectedIds([]);
    setDueDate('');
    setAssignedCount(0);
    setNotificationFailed(false);
    setError(null);

    let cancelled = false;
    setIsLoadingCourses(true);
    // NOT `getCourses()` — that omits the global video catalogue, so an org
    // that had adopted no prebuilt course saw an empty Video Courses tab here
    // while the same courses were listed (and assignable) elsewhere.
    getAssignableCourses()
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
  const assignLabel = selectedCount > 1 ? `Assign ${selectedCount} courses` : 'Assign Course';

  const handleAssign = async () => {
    if (selectedCount === 0) return;
    setIsSubmitting(true);
    setError(null);
    setNotificationFailed(false);
    try {
      const result = await assignCoursesToStaffMember(staffOrgUserId, selectedIds, {
        dueAt: dueDate || null,
      });

      if (result.assigned.length === 0) {
        setError(
          result.error ??
            (result.alreadyAssigned.length > 0
              ? `${staffName} is already assigned to the selected course${
                  result.alreadyAssigned.length === 1 ? '' : 's'
                }.`
              : 'Could not assign the selected courses.'),
        );
        return;
      }

      setAssignedCount(result.assigned.length);
      // The enrollments are committed either way, so a failed announcement is a
      // warning on the success step — never an error implying nothing landed.
      // An invited address was reached by the `/join` email instead.
      setNotificationFailed(!result.emailSent && !result.invited);
      setStep('success');
    } catch (err) {
      logger.error({ msg: '[staff] Failed to assign courses', err, staffOrgUserId });
      setError(err instanceof Error ? err.message : 'Failed to assign the selected courses.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDone = () => {
    onClose();
    router.refresh();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
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
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-lg font-semibold text-foreground">
                Assign Courses
              </DialogTitle>
              <DialogDescription className="text-sm text-text-secondary">
                Choose the courses these staffs will be assigned to.
              </DialogDescription>
            </div>

            <div role="tablist" aria-label="Course type" className="grid grid-cols-2 gap-3">
              {TABS.map(({ id, label, icon: Icon }) => {
                const isActive = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(id)}
                    className={cn(
                      'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition-colors',
                      isActive
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border bg-background text-foreground hover:bg-background-secondary',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>

            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={SEARCH_PLACEHOLDER[tab]}
              aria-label={SEARCH_PLACEHOLDER[tab]}
              className="h-11"
              startIcon={<Search aria-hidden="true" />}
            />

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground">Select course</span>
                {selectedCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {selectedCount} selected
                  </span>
                )}
              </div>

              <div className="max-h-[212px] overflow-y-auto rounded-[10px] border border-border">
                {isLoadingCourses ? (
                  <p className="px-4 py-8 text-center text-sm text-text-secondary">
                    Loading courses…
                  </p>
                ) : visibleCourses.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-text-secondary">
                    No {tab === 'video' ? 'video' : 'reading'} courses found.
                  </p>
                ) : (
                  visibleCourses.map((course) => {
                    const isSelected = selectedIds.includes(course.id);
                    return (
                      <label
                        key={course.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0',
                          isSelected ? 'bg-primary/5' : 'hover:bg-background-secondary',
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleCourse(course.id)}
                          aria-label={course.title}
                        />
                        {tab === 'reading' && (
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[#1a202c] text-white">
                            <BookOpen className="size-[18px]" aria-hidden="true" />
                          </span>
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              'truncate text-sm font-medium',
                              isSelected ? 'text-primary' : 'text-foreground',
                            )}
                          >
                            {course.title}
                          </span>
                          <span className="truncate text-xs text-text-secondary">
                            {course.description ?? 'No description provided.'}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => setStep('deadline')}
                disabled={selectedCount === 0}
                className="disabled:bg-primary/40 disabled:text-primary-foreground"
              >
                {assignLabel}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'deadline' && (
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-lg font-semibold text-foreground">
                Set Completion Deadline
              </DialogTitle>
              <DialogDescription className="text-sm text-text-secondary">
                Set a deadline for staff to complete this courses.
              </DialogDescription>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Completion deadline (optional)
              </span>
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                placeholder="Select due date"
                label="Completion deadline"
                iconPosition="start"
                showYearSelect
                placement="top-end"
                className="h-11"
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

            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setStep('select')}
                disabled={isSubmitting}
              >
                Cancel
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
            <DialogTitle className="text-xl font-semibold text-foreground">
              Courses Assigned Successfully
            </DialogTitle>
            <DialogDescription className="text-sm text-text-secondary">
              <span className="font-medium text-primary">&ldquo;{staffName}&rdquo;</span> have been
              assigned to {assignedCount} course{assignedCount === 1 ? '' : 's'}. They can now
              access the courses and complete them before the set deadline.
            </DialogDescription>
            {notificationFailed && (
              <Alert variant="warning" title="We couldn’t email them" className="text-left">
                The {assignedCount === 1 ? 'course is' : 'courses are'} assigned and already visible
                to {staffName}, but the notification email could not be sent. Let them know
                directly.
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
