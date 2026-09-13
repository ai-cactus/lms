'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Clock } from 'lucide-react';
import { RenewalCycle, ReminderStage, UserRole } from '@/generated/prisma/enums';
import Logo from '@/components/ui/Logo';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DatePicker from '@/components/ui/DatePicker';
import TimePicker from '@/components/ui/TimePicker';
import { cn } from '@/lib/utils';
import { REMINDER_STAGE_DEFAULTS, SWEEP_STAGES } from '@/lib/reminders/stages';
import { combineDateAndTime, formatTimeOfDay } from '@/lib/reminders/deadline';
import AssigneesInput, {
  type AssigneesInputHandle,
} from '@/components/dashboard/enrollment/AssigneesInput';
import RoleTargetPicker, {
  type RoleTargetPickerMode,
} from '@/components/dashboard/enrollment/RoleTargetPicker';
import {
  enrollUsers,
  assignCourseToRoles,
  type CourseAssignmentSettings,
} from '@/app/actions/enrollment';
import { publishCourse } from '@/app/actions/course';
import { logger } from '@/lib/logger';
import type { StaffEntry } from '@/types/enrollment';

const RENEWAL_OPTIONS: { value: RenewalCycle; label: string }[] = [
  { value: 'none', label: 'No renewal' },
  { value: 'monthly', label: 'Monthly Renewal (1 Month)' },
  { value: 'quarterly', label: 'Quarterly Renewal (3 Months)' },
  { value: 'semiannual', label: 'Semi-Annual Renewal (6 Months)' },
  { value: 'annual', label: 'Annual Renewal (12 Months)' },
];

/** Human-readable labels for the editable reminder ladder (sweep stages only). */
const STAGE_LABELS: Record<ReminderStage, string> = {
  INITIAL_LAUNCH: 'Launch',
  FRIENDLY_REMINDER: 'Friendly reminder',
  URGENT_REMINDER: 'Urgent reminder',
  DAY_OF_DEADLINE: 'Day of deadline',
  GRACE_SOFT_ESCALATION: 'Grace period (soft escalation)',
  HARD_ESCALATION: 'Overdue (hard escalation)',
  // Fixed system stage — excluded from the editable form (SWEEP_STAGES); entry satisfies the Record type.
  ADMIN_PRE_DEADLINE_REMINDER: 'Admin pre-deadline reminder',
};

interface StageRow {
  stage: ReminderStage;
  offsetDays: number;
  enabled: boolean;
}

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
  const [renewalCycle, setRenewalCycle] = useState<RenewalCycle>(
    existingSettings?.renewalCycle ?? 'annual',
  );
  const [remindersEnabled, setRemindersEnabled] = useState(
    existingSettings?.remindersEnabled ?? true,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stages, setStages] = useState<StageRow[]>(() =>
    SWEEP_STAGES.map((stage) => {
      const saved = existingSettings?.stages.find((s) => s.stage === stage);
      return {
        stage,
        offsetDays: saved?.offsetDays ?? REMINDER_STAGE_DEFAULTS[stage].offsetDays,
        enabled: saved?.enabled ?? true,
      };
    }),
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

  // ── Reminder cadence ───────────────────────────────────────────────────────
  const setStageOffset = (stage: ReminderStage, offsetDays: number) =>
    setStages((prev) => prev.map((s) => (s.stage === stage ? { ...s, offsetDays } : s)));
  const setStageEnabled = (stage: ReminderStage, enabled: boolean) =>
    setStages((prev) => prev.map((s) => (s.stage === stage ? { ...s, enabled } : s)));

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
          renewalCycle,
          remindersEnabled,
          stages,
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
          renewalCycle,
          remindersEnabled,
          stages,
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
            />
            <TimePicker value={dueTime} onChange={setDueTime} placeholder="Select due time" />
          </div>
        </SettingRow>

        <div className="my-6 h-px bg-border" />

        <SettingRow
          title="Renewal Settings"
          description="Choose a date for staffs to renew this course"
        >
          <Select value={renewalCycle} onValueChange={(v) => setRenewalCycle(v as RenewalCycle)}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RENEWAL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <div className="my-6 h-px bg-border" />

        <SettingRow
          title="Deadline Reminders"
          description="Send workers automated reminders as the deadline approaches and escalate when overdue."
        >
          <label className="flex items-center gap-2.5">
            <Checkbox
              checked={remindersEnabled}
              onCheckedChange={(checked) => setRemindersEnabled(checked === true)}
              disabled={submitting}
            />
            <span className="text-sm font-medium text-foreground">Send deadline reminders</span>
          </label>
        </SettingRow>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            aria-expanded={showAdvanced}
            className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline disabled:opacity-50"
            disabled={!remindersEnabled || submitting}
          >
            <ChevronDown
              className={cn('size-4 transition-transform', showAdvanced && 'rotate-180')}
              aria-hidden="true"
            />
            Advanced reminder schedule
          </button>

          {showAdvanced && (
            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-background-secondary p-4">
              <p className="text-xs text-text-secondary">
                Offset is in days relative to the deadline: negative = days before, 0 = day of,
                positive = days after.
              </p>
              {stages.map((row) => (
                <div
                  key={row.stage}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm font-medium text-foreground">
                    {STAGE_LABELS[row.stage]}
                  </span>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      step={1}
                      value={row.offsetDays}
                      onChange={(e) =>
                        setStageOffset(
                          row.stage,
                          e.target.value === '' ? 0 : Number(e.target.value),
                        )
                      }
                      disabled={!remindersEnabled || !row.enabled || submitting}
                      aria-label={`${STAGE_LABELS[row.stage]} offset in days`}
                      className="h-10 w-24"
                    />
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={row.enabled}
                        onCheckedChange={(checked) => setStageEnabled(row.stage, checked === true)}
                        disabled={!remindersEnabled || submitting}
                      />
                      <span className="text-sm text-text-secondary">Enabled</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
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
