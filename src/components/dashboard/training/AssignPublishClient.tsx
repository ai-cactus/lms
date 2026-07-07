'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, X } from 'lucide-react';
import { RenewalCycle, ReminderStage } from '@/generated/prisma/enums';
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
import { enrollUsers } from '@/app/actions/enrollment';
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
};

interface StageRow {
  stage: ReminderStage;
  offsetDays: number;
  enabled: boolean;
}

interface AssignPublishClientProps {
  courseId: string;
  courseTitle: string;
  courseStatus: string;
}

export default function AssignPublishClient({
  courseId,
  courseTitle,
  courseStatus,
}: AssignPublishClientProps) {
  const router = useRouter();

  // An already-published course is being assigned (not freshly created), so the
  // UI should read "Assign" rather than "Assigning & Publish".
  const isExisting = courseStatus === 'published';

  const [entries, setEntries] = useState<StaffEntry[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [renewalCycle, setRenewalCycle] = useState<RenewalCycle>('annual');
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stages, setStages] = useState<StageRow[]>(() =>
    SWEEP_STAGES.map((stage) => ({
      stage,
      offsetDays: REMINDER_STAGE_DEFAULTS[stage].offsetDays,
      enabled: true,
    })),
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
  const canPublish = entries.length > 0 && !submitting;

  const handlePublish = async () => {
    if (entries.length === 0) {
      setError('Add at least one person to assign this course to.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
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
      {/* Top bar */}
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

        {error && (
          <Alert variant="error" className="mb-6">
            {error}
          </Alert>
        )}

        {/* Assign To */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <label className="pt-3 text-sm text-text-secondary sm:w-[160px] sm:shrink-0">
            Assign To
          </label>
          <div className="flex flex-1 items-start gap-3">
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
        </div>

        <div className="my-6 h-px bg-border" />

        {/* Training Schedule */}
        <SettingRow
          title="Training Schedule"
          description="Workers will receive access on this date"
        >
          <DatePicker value={scheduleDate} onChange={setScheduleDate} placeholder="Select date" />
        </SettingRow>

        <div className="my-6 h-px bg-border" />

        {/* Due Date */}
        <SettingRow
          title="Due Date"
          description="Deadline for completing the course. Leave empty to compute it automatically."
        >
          <DatePicker value={dueDate} onChange={setDueDate} placeholder="Select due date" />
        </SettingRow>

        <div className="my-6 h-px bg-border" />

        {/* Renewal Settings */}
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

        {/* Deadline reminders */}
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

        {/* Advanced reminder schedule */}
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

        {/* Footer actions */}
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

      {/* Success modal */}
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
              Workers have been assigned and are now enrolled in this course.
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
