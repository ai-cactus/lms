'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Clock, Users, X } from 'lucide-react';
import { RenewalCycle, ReminderStage } from '@/generated/prisma/enums';
import { ALL_ROLES, getRoleDisplayName } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
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
import { cn } from '@/lib/utils';
import { REMINDER_STAGE_DEFAULTS, SWEEP_STAGES } from '@/lib/reminders/stages';
import {
  enrollUsers,
  assignCourseToRole,
  type CourseAssignmentSettings,
} from '@/app/actions/enrollment';
import { publishCourse } from '@/app/actions/course';
import { logger } from '@/lib/logger';
import type { StaffEntry } from '@/types/enrollment';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** How the course is being targeted: named individuals, or a whole role. */
type AssignMode = 'people' | 'role';

interface AssignPublishClientProps {
  courseId: string;
  courseTitle: string;
  courseStatus: string;
  /** The org's saved assignment settings, when this course was already assigned. */
  existingSettings?: CourseAssignmentSettings | null;
  /** Current headcount per role in the org, so role mode can preview enrollment. */
  roleHolderCounts?: Record<string, number>;
  /** Emails assigned this course that haven't accepted their invite yet. */
  pendingInvitedEmails?: string[];
}

/** Format a stored deadline/schedule Date as the `YYYY-MM-DD` DatePicker expects. */
function toDateInput(value: Date | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

export default function AssignPublishClient({
  courseId,
  courseTitle,
  courseStatus,
  existingSettings = null,
  roleHolderCounts = {},
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

  // A course already assigned to a role re-opens in role mode.
  const [mode, setMode] = useState<AssignMode>(existingSettings?.targetRole ? 'role' : 'people');
  const [targetRole, setTargetRole] = useState<Role>(
    (existingSettings?.targetRole as Role | null) ?? 'nurse',
  );

  const [entries, setEntries] = useState<StaffEntry[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [scheduleDate, setScheduleDate] = useState(() => toDateInput(existingSettings?.scheduleAt));
  const [dueDate, setDueDate] = useState(() => toDateInput(existingSettings?.dueAt));
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

  // ── Assignees ────────────────────────────────────────────────────────────
  const addEmails = (raw: string) => {
    const candidates = raw
      .split(/[\s,;]+/)
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    if (candidates.length === 0) return;
    setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.email));
      const next = [...prev];
      for (const email of candidates) {
        if (EMAIL_REGEX.test(email) && !seen.has(email)) {
          seen.add(email);
          next.push({ email });
        }
      }
      return next;
    });
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', 'Tab', ',', ' '].includes(e.key)) {
      e.preventDefault();
      addEmails(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && entries.length > 0) {
      setEntries((prev) => prev.slice(0, -1));
    }
  };

  const removeEntry = (index: number) => setEntries((prev) => prev.filter((_, i) => i !== index));

  // ── Reminder cadence ───────────────────────────────────────────────────────
  const setStageOffset = (stage: ReminderStage, offsetDays: number) =>
    setStages((prev) => prev.map((s) => (s.stage === stage ? { ...s, offsetDays } : s)));
  const setStageEnabled = (stage: ReminderStage, enabled: boolean) =>
    setStages((prev) => prev.map((s) => (s.stage === stage ? { ...s, enabled } : s)));

  // ── Publish ──────────────────────────────────────────────────────────────
  const roleHolderCount = roleHolderCounts[targetRole] ?? 0;
  const canPublish = (mode === 'role' || entries.length > 0) && !submitting;

  const handlePublish = async () => {
    if (mode === 'people' && entries.length === 0) {
      setError('Add at least one person to assign this course to.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'role') {
        // Role targets never carry an absolute due date — the deadline is computed
        // per user from their role-join date and the window.
        await assignCourseToRole(courseId, targetRole, {
          scheduleAt: scheduleDate ? new Date(scheduleDate) : null,
          renewalCycle,
          remindersEnabled,
          stages,
        });
      } else {
        const res = await enrollUsers(courseId, entries, {
          scheduleAt: scheduleDate ? new Date(scheduleDate) : null,
          dueAt: dueDate ? new Date(dueDate) : null,
          renewalCycle,
          remindersEnabled,
          stages,
        });

        if (res.failed.length > 0 && res.success.length + res.newInvited.length === 0) {
          setError(`Could not assign: ${res.failed.join(', ')}`);
          return;
        }
      }

      // Publish a still-draft course as part of finalizing (best-effort — a
      // global/already-published course needs no status change).
      if (courseStatus !== 'published') {
        try {
          await publishCourse(courseId);
        } catch (err) {
          logger.warn({ msg: '[assign] publish skipped', err, courseId });
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
                  {m === 'people' ? 'Specific people' : 'A whole role'}
                </button>
              ))}
            </div>

            {mode === 'people' ? (
              <div className="flex items-start gap-3">
                <div
                  className="flex min-h-12 flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-primary bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-primary"
                  onClick={() => document.getElementById('assign-input')?.focus()}
                >
                  {entries.map((entry, index) => (
                    <span
                      key={entry.email}
                      className="flex items-center rounded bg-secondary px-2 py-1 text-[13px] font-medium text-foreground"
                    >
                      {entry.email}
                      <button
                        type="button"
                        className="ml-1.5 text-text-secondary hover:text-error"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeEntry(index);
                        }}
                        aria-label={`Remove ${entry.email}`}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  <input
                    id="assign-input"
                    className="min-w-[160px] flex-1 border-none bg-transparent text-sm text-foreground outline-none"
                    placeholder={entries.length === 0 ? 'Add people, emails or names' : ''}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={submitting}
                  />
                </div>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => addEmails(inputValue)}
                  disabled={submitting}
                >
                  Invite
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Select
                  value={targetRole}
                  onValueChange={(v) => setTargetRole(v as Role)}
                  disabled={submitting}
                >
                  <SelectTrigger className="h-11 w-full sm:w-[320px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {getRoleDisplayName(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                  <Users className="size-4 shrink-0" aria-hidden="true" />
                  {roleHolderCount === 0 ? (
                    <>
                      No one currently holds this role. Anyone assigned{' '}
                      {getRoleDisplayName(targetRole)} later will be enrolled automatically.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-foreground">
                        {roleHolderCount} {roleHolderCount === 1 ? 'person' : 'people'}
                      </span>{' '}
                      will be enrolled now — plus anyone assigned this role later.
                    </>
                  )}
                </p>
              </div>
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
        >
          <DatePicker value={scheduleDate} onChange={setScheduleDate} placeholder="Select date" />
        </SettingRow>

        <div className="my-6 h-px bg-border" />

        {mode === 'people' && (
          <>
            <SettingRow
              title="Due Date"
              description="Deadline for completing the course. Leave empty to compute it automatically."
            >
              <DatePicker value={dueDate} onChange={setDueDate} placeholder="Select due date" />
            </SettingRow>

            <div className="my-6 h-px bg-border" />
          </>
        )}

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
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
      </div>
      <div className="w-full sm:w-[320px] sm:shrink-0">{children}</div>
    </div>
  );
}
