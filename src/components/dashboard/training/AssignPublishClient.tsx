'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Clock } from 'lucide-react';
import { RenewalCycle, UserRole } from '@/generated/prisma/enums';
import Logo from '@/components/ui/Logo';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import DatePicker from '@/components/ui/DatePicker';
import TimePicker from '@/components/ui/TimePicker';
import { cn } from '@/lib/utils';
import {
  DEFAULT_WIZARD_REMINDER_DAYS,
  stageRowsToReminderDays,
} from '@/lib/enrollment/reminder-ladder';
import { combineDateAndTime, formatTimeOfDay } from '@/lib/reminders/deadline';
import AssigneesInput, {
  type AssigneesInputHandle,
} from '@/components/dashboard/enrollment/AssigneesInput';
import RoleTargetPicker, {
  type RoleTargetPickerMode,
} from '@/components/dashboard/enrollment/RoleTargetPicker';
import ReminderLadderInput, {
  type ReminderLadderRow,
} from '@/components/dashboard/enrollment/ReminderLadderInput';
import RenewalScheduleInput, {
  DEFAULT_RENEWAL_CYCLE,
} from '@/components/dashboard/enrollment/RenewalScheduleInput';
import {
  enrollUsers,
  assignCourseToRoles,
  type CourseAssignmentSettings,
} from '@/app/actions/enrollment';
import { publishCourse } from '@/app/actions/course';
import { logger } from '@/lib/logger';
import type { StaffEntry } from '@/types/enrollment';

/** How the course is being targeted: named individuals, or one or more roles. */
type AssignMode = 'people' | 'role';

interface AssignPublishClientProps {
  courseId: string;
  courseTitle: string;
  courseStatus: string;
  /** The org's saved assignment settings, when this course was already assigned. */
  existingSettings?: CourseAssignmentSettings | null;
  /** Current headcount per role in the org, so role mode can preview enrollment. */
  roleHolderCounts?: Record<string, number>;
  /** The viewer holds `assignment.delete`, so targeted roles may be removed (D6). */
  canRevokeRoleTargets?: boolean;
  /** Emails assigned this course that haven't accepted their invite yet. */
  pendingInvitedEmails?: string[];
}

/**
 * Split a stored deadline/schedule Date into the two halves this page edits:
 * the `YYYY-MM-DD` DatePicker value and the `"H:MM AM/PM"` TimePicker value.
 *
 * Both halves read the UTC clock, matching `combineDateAndTime`, which is what
 * re-joins them on submit. Reading the calendar day in UTC and the hour locally
 * (or the reverse) would not round-trip.
 */
function toDateInput(value: Date | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function toTimeInput(value: Date | null | undefined): string {
  return value ? formatTimeOfDay(new Date(value)) : '';
}

export default function AssignPublishClient({
  courseId,
  courseTitle,
  courseStatus,
  existingSettings = null,
  roleHolderCounts = {},
  canRevokeRoleTargets = false,
  pendingInvitedEmails = [],
}: AssignPublishClientProps) {
  const router = useRouter();

  // An already-published course is being assigned (not freshly created), so the
  // UI should read "Assign" rather than "Assigning & Publish".
  const isExisting = courseStatus === 'published';

  // Re-opening the page for a course that already has an assignment prefills the
  // live settings so a re-submit updates the same assignment instead of resetting
  // it to factory defaults.
  const hasExistingAssignment = existingSettings !== null;

  // A course already assigned to one or more roles re-opens in role mode.
  const [mode, setMode] = useState<AssignMode>(
    existingSettings?.targetRoles.length ? 'role' : 'people',
  );
  const [targetRoles, setTargetRoles] = useState<UserRole[]>(
    () => existingSettings?.targetRoles ?? [],
  );

  const [entries, setEntries] = useState<StaffEntry[]>([]);
  const [scheduleDate, setScheduleDate] = useState(() => toDateInput(existingSettings?.scheduleAt));
  const [scheduleTime, setScheduleTime] = useState(() => toTimeInput(existingSettings?.scheduleAt));
  const [dueDate, setDueDate] = useState(() => toDateInput(existingSettings?.dueAt));
  const [dueTime, setDueTime] = useState(() => toTimeInput(existingSettings?.dueAt));
  // `'none'` is how a non-recurring course is stored, and it is now expressed by
  // the toggle rather than by an interval — so a stored `'none'` re-opens with
  // the toggle off, and the interval beneath it falls back to the same default a
  // never-assigned course gets, ready for the moment the toggle is turned on.
  // A course with no assignment yet therefore starts ON at `'annual'`: that is
  // what this page has always persisted for an untouched new assignment.
  const storedRenewalCycle = existingSettings?.renewalCycle ?? DEFAULT_RENEWAL_CYCLE;
  const [recurringEnabled, setRecurringEnabled] = useState(storedRenewalCycle !== 'none');
  const [renewalCycle, setRenewalCycle] = useState<RenewalCycle>(
    storedRenewalCycle === 'none' ? DEFAULT_RENEWAL_CYCLE : storedRenewalCycle,
  );
  const [remindersEnabled, setRemindersEnabled] = useState(
    existingSettings?.remindersEnabled ?? true,
  );
  // The stored ladder read back into the "N days before" vocabulary this page now
  // speaks. A course with no assignment yet starts from the canonical defaults:
  // submitting an untouched empty ladder would read as "the admin cleared every
  // reminder" and disable the worker stages the new row would otherwise be seeded
  // with.
  const [reminderRows, setReminderRows] = useState<ReminderLadderRow[]>(() =>
    (existingSettings
      ? stageRowsToReminderDays(existingSettings.stages)
      : DEFAULT_WIZARD_REMINDER_DAYS
    ).map((value) => ({ value, unit: 'days' as const })),
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Commits whatever is typed when the host's own "Invite" button is pressed.
  const assigneesRef = useRef<AssigneesInputHandle>(null);

  // ── Schedule & deadline ────────────────────────────────────────────────────
  // A time with no date beside it is inert (the pair only becomes a timestamp
  // when both are set), so clearing the date clears the time rather than leaving
  // an hour showing for a deadline that no longer exists.
  const handleScheduleDateChange = (next: string) => {
    setScheduleDate(next);
    if (!next) setScheduleTime('');
  };
  const handleDueDateChange = (next: string) => {
    setDueDate(next);
    if (!next) setDueTime('');
  };

  // ── Publish ──────────────────────────────────────────────────────────────
  /**
   * The picker writes through to a live assignment row itself (D5) — but only
   * once that row is ALREADY role-targeted.
   *
   * A row created by an individual assignment carries no recorded facility scope
   * (`facilityScoped: false`, i.e. org-wide), so editing it in place would let a
   * facility-bound assigner inherit an org-wide reach. Going through submit
   * instead records the assigner's own scope, which is what every later
   * auto-enrolment is then held to. Clearing every role in place drops back to
   * `draft` for the same reason — the row's recorded reach goes with them.
   * `canCreate` needs no separate check: the page redirects anyone without
   * `assignment.create` before it renders.
   */
  const pickerMode: RoleTargetPickerMode =
    existingSettings && targetRoles.length > 0
      ? {
          kind: 'live',
          assignmentId: existingSettings.assignmentId,
          enrolledCount: existingSettings.enrolledCount,
          canCreate: true,
          canRevoke: canRevokeRoleTargets,
        }
      : { kind: 'draft' };

  const canPublish = (mode === 'role' ? targetRoles.length > 0 : entries.length > 0) && !submitting;

  const handlePublish = async () => {
    if (mode === 'people' && entries.length === 0) {
      setError('Add at least one person to assign this course to.');
      return;
    }
    if (mode === 'role' && targetRoles.length === 0) {
      setError('Choose at least one role to assign this course to.');
      return;
    }
    setSubmitting(true);
    setError(null);

    // This page has no deadline-window control, but both assign paths write the
    // column unconditionally — so omitting it would silently clear, org-wide, a
    // window the course wizard set. Round-trip the saved value instead.
    const dueWindowDays = existingSettings?.dueWindowDays ?? null;

    // Both stored values are edited here as a date + a time-of-day, so both are
    // re-joined the way every other surface joins them. Without the time half a
    // re-save from this page truncated a wizard-set 5pm deadline to 00:00 UTC.
    const scheduleAt = combineDateAndTime(
      scheduleDate ? new Date(scheduleDate) : null,
      scheduleTime,
    );

    // The ladder is always submitted, never omitted: the control is prefilled
    // from what is stored, so an empty list can only mean the admin removed
    // every row — "no pre-deadline reminders" — and the server disables exactly
    // the three worker stages this vocabulary owns. The grace/overdue stages are
    // outside it and keep whatever offsets the org has.
    const reminderDaysBefore = reminderRows.map((row) => row.value);

    // The toggle is the only way to say "this course does not recur" now that
    // the interval list no longer carries a "No renewal" row — so it, not the
    // Select, decides when the stored `'none'` is written.
    const submittedRenewalCycle: RenewalCycle = recurringEnabled ? renewalCycle : 'none';

    try {
      if (mode === 'role') {
        // An absolute date wins for every holder; without one each holder falls
        // back to the window, counted from their own role-join date (the
        // precedence computeDueAt implements). `assignCourseToRoles` takes the
        // date under `dueDate`, not `dueAt` — it pairs it with the time
        // server-side, so this branch hands over the halves rather than joining
        // them, matching what the wizard sends.
        const res = await assignCourseToRoles(courseId, targetRoles, {
          scheduleAt,
          dueDate: dueDate ? new Date(dueDate) : null,
          dueTime: dueTime || null,
          dueWindowDays,
          renewalCycle: submittedRenewalCycle,
          remindersEnabled,
          reminderDaysBefore,
        });

        // A refusal is returned rather than thrown, so it must be surfaced here
        // and stop the flow before the course is published or success is shown.
        if (res.refusedReason) {
          setError(res.refusedReason);
          return;
        }
      } else {
        // `enrollUsers` takes a single absolute `dueAt`, so the halves are joined
        // here. Combining client-side needs no action-signature change:
        // `combineDateAndTime` lives in a plain module, not a `'use server'` one.
        const res = await enrollUsers(courseId, entries, {
          scheduleAt,
          dueAt: combineDateAndTime(dueDate ? new Date(dueDate) : null, dueTime),
          dueWindowDays,
          renewalCycle: submittedRenewalCycle,
          remindersEnabled,
          reminderDaysBefore,
        });

        if (res.refusedReason) {
          setError(res.refusedReason);
          return;
        }

        if (res.failed.length > 0 && res.success.length + res.newInvited.length === 0) {
          setError(`Could not assign: ${res.failed.join(', ')}`);
          return;
        }
      }

      // Assigning already publishes an unheld draft server-side
      // (publishCourseOnAssignment), so this only still matters for the
      // publish-without-assigning case and for clearing a review hold.
      //
      // publishCourse RETURNS its refusal rather than throwing — a quality-gate
      // hold comes back as { success: false }. The old try/catch therefore
      // caught nothing and the discarded result made a failed publish invisible,
      // which is part of how courses stayed "Draft" while in use.
      if (courseStatus !== 'published') {
        try {
          const publishResult = await publishCourse(courseId);
          if (!publishResult.success) {
            logger.warn({
              msg: '[assign] Course assigned but not published',
              courseId,
              reason: publishResult.error,
            });
          }
        } catch (err) {
          logger.error({ msg: '[assign] publish threw unexpectedly', err, courseId });
        }
      }

      setShowSuccess(true);
    } catch (err) {
      logger.error({ msg: '[assign] failed to assign & publish', err, courseId });
      setError(err instanceof Error ? err.message : 'Failed to publish. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">
      <header className="flex h-[72px] items-center border-b border-border">
        <div className="flex h-full items-center border-r border-border px-6">
          <Logo size="sm" />
        </div>
        <span className="px-6 text-base font-semibold text-foreground">
          {isExisting ? 'Assign' : 'Assigning & Publish'}
        </span>
        <Link
          href="/dashboard"
          className="ml-auto px-8 text-base font-semibold text-foreground hover:text-primary"
        >
          Exit
        </Link>
      </header>

      <div className="mx-auto w-full max-w-[1100px] px-6 py-10">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-foreground">
            {isExisting ? 'Assign' : 'Assigning & Publish'}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            {isExisting
              ? 'Select which staff should take this course, set deadlines, and reminders.'
              : 'Select which staff should take this course, set deadlines, and finalize publishing.'}
          </p>
        </div>

        {hasExistingAssignment && (
          <Alert variant="info" className="mb-6">
            This course has an existing assignment — the schedule, deadline, renewal, and reminder
            settings below are its current values, and saving will update them for everyone already
            assigned.
          </Alert>
        )}

        {error && (
          <Alert variant="error" className="mb-6">
            {error}
          </Alert>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <label className="pt-3 text-sm text-text-secondary sm:w-[160px] sm:shrink-0">
            Assign To
          </label>
          <div className="flex flex-1 flex-col gap-4">
            <div className="inline-flex w-fit rounded-lg border border-border bg-background-secondary p-1">
              {(['people', 'role'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  disabled={submitting}
                  aria-pressed={mode === m}
                  className={cn(
                    'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50',
                    mode === m
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-text-secondary hover:text-foreground',
                  )}
                >
                  {m === 'people' ? 'Specific people' : 'Roles'}
                </button>
              ))}
            </div>

            {mode === 'people' ? (
              <div className="flex items-start gap-3">
                <AssigneesInput
                  ref={assigneesRef}
                  value={entries.map((entry) => entry.email)}
                  onChange={(next) => setEntries(next.map((email) => ({ email })))}
                  enableBulkImport
                  disabled={submitting}
                  className="min-h-12 flex-1 border-primary"
                />
                <Button
                  type="button"
                  size="lg"
                  onClick={() => assigneesRef.current?.commitDraft()}
                  disabled={submitting}
                >
                  Invite
                </Button>
              </div>
            ) : (
              <RoleTargetPicker
                selectedRoles={targetRoles}
                onSelectionChange={setTargetRoles}
                mode={pickerMode}
                roleHolderCounts={roleHolderCounts}
                disabled={submitting}
                onLiveUpdateError={setError}
              />
            )}
          </div>
        </div>

        {pendingInvitedEmails.length > 0 && (
          <div className="mt-6 rounded-lg border border-border bg-background-secondary p-4">
            <div className="flex items-center gap-2">
              <Clock className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">
                Pending invites for this course
              </h3>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              These people were assigned this course but haven&apos;t accepted their invite yet.
              They&apos;ll be enrolled automatically once they join.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {pendingInvitedEmails.map((email) => (
                <span
                  key={email}
                  className="rounded bg-background px-2 py-1 text-[13px] font-medium text-foreground"
                >
                  {email}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="my-6 h-px bg-border" />

        <SettingRow
          title="Training Schedule"
          description="Workers will receive access on this date"
          contentClassName="md:w-[440px]"
        >
          {/* No `label` on either picker: reminders.spec.ts resolves them by
              accessible name, which for these controls is their placeholder. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DatePicker
              value={scheduleDate}
              onChange={handleScheduleDateChange}
              placeholder="Select date"
              clearLabel="Clear schedule date"
            />
            <TimePicker value={scheduleTime} onChange={setScheduleTime} placeholder="Select time" />
          </div>
        </SettingRow>

        <div className="my-6 h-px bg-border" />

        <SettingRow
          title="Due Date"
          description="A hard deadline everyone shares. Leave it empty and each person gets their own, counted from when they start the course or join the role."
          contentClassName="md:w-[440px]"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DatePicker
              value={dueDate}
              onChange={handleDueDateChange}
              placeholder="Select due date"
              clearLabel="Clear due date"
            />
            <TimePicker value={dueTime} onChange={setDueTime} placeholder="Select due time" />
          </div>
        </SettingRow>

        <div className="my-6 h-px bg-border" />

        <RenewalScheduleInput
          toggleLabel="Renewal Settings"
          header={
            <div>
              <h3 className="text-lg font-bold text-foreground">Renewal Settings</h3>
              <p className="mt-0.5 text-sm text-text-secondary">
                Choose a date for staffs to renew this course
              </p>
            </div>
          }
          enabled={recurringEnabled}
          onEnabledChange={setRecurringEnabled}
          cycle={renewalCycle}
          onCycleChange={setRenewalCycle}
          disabled={submitting}
        />

        <div className="my-6 h-px bg-border" />

        <SettingRow
          title="Deadline Reminders"
          description="Send workers automated reminders as the deadline approaches and escalate when overdue."
        >
          <label className="flex items-center gap-2.5">
            <Switch
              checked={remindersEnabled}
              onCheckedChange={setRemindersEnabled}
              disabled={submitting}
            />
            <span className="text-sm font-medium text-foreground">Send deadline reminders</span>
          </label>
        </SettingRow>

        <div className="mt-6">
          <p className="text-sm text-text-secondary">
            Staff are reminded automatically before the deadline. Add more if you need them.
          </p>
          <ReminderLadderInput
            value={reminderRows}
            onChange={setReminderRows}
            disabled={!remindersEnabled || submitting}
            className="mt-3 items-start"
          />
        </div>

        <div className="mt-12 flex items-center justify-between">
          <Button type="button" variant="outline" size="lg" onClick={() => router.back()}>
            Back
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={handlePublish}
            loading={submitting}
            disabled={!canPublish}
          >
            {isExisting ? 'Assign Course' : 'Publish Course'}
          </Button>
        </div>
      </div>

      <Dialog open={showSuccess} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          {/* Visually-hidden accessible title (Radix requires a DialogTitle). */}
          <DialogTitle className="sr-only">{courseTitle} assigned successfully</DialogTitle>
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-[#c6f6d5]">
              <span className="flex size-12 items-center justify-center rounded-full bg-[#38a169]">
                <Check className="size-6 text-white" strokeWidth={3} aria-hidden="true" />
              </span>
            </span>
            <h2 className="text-xl font-bold text-foreground">Course Assigned Successfully</h2>
            <p className="text-sm text-text-secondary">
              Existing workers are now enrolled. Anyone who hasn&apos;t joined yet will be enrolled
              when they accept their invite.
            </p>
            <div className="mt-4 flex w-full flex-col gap-3">
              <Button onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
              <Button variant="outline" onClick={() => router.push('/dashboard/courses')}>
                Go to Courses
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
  contentClassName,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Widens the control column for rows that host a pair of controls. */
  contentClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
      </div>
      <div className={cn('w-full sm:w-[320px] sm:shrink-0', contentClassName)}>{children}</div>
    </div>
  );
}
