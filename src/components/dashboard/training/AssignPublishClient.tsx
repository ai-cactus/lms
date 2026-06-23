'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Clock, Plus, X } from 'lucide-react';
import { RenewalCycle } from '@/generated/prisma/enums';
import Logo from '@/components/ui/Logo';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DatePicker from '@/components/ui/DatePicker';
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

const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
  { value: 10080, label: '1 week before' },
];

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

  const [entries, setEntries] = useState<StaffEntry[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [renewalCycle, setRenewalCycle] = useState<RenewalCycle>('annual');
  const [reminders, setReminders] = useState<number[]>([30]);

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

  // ── Reminders ────────────────────────────────────────────────────────────
  const addReminder = () => {
    // Default each new reminder to the first option not already chosen.
    const used = new Set(reminders);
    const next = REMINDER_OPTIONS.find((o) => !used.has(o.value))?.value ?? 30;
    setReminders((prev) => [...prev, next]);
  };
  const setReminderAt = (index: number, value: number) =>
    setReminders((prev) => prev.map((r, i) => (i === index ? value : r)));
  const removeReminder = (index: number) =>
    setReminders((prev) => prev.filter((_, i) => i !== index));

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
        renewalCycle,
        reminders: reminders.map((offsetMinutes) => ({ offsetMinutes, channel: 'email' })),
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
          Assigning &amp; Publish
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
          <h1 className="text-3xl font-bold text-foreground">Assigning &amp; Publish</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Select which staff should take this course, set deadlines, and finalize publishing.
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

        {/* Reminders */}
        <SettingRow
          title="Reminder"
          description="Workers will receive email reminders on this date"
        >
          <div className="flex flex-col gap-3">
            {reminders.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select
                  value={String(value)}
                  onValueChange={(v) => setReminderAt(index, Number(v))}
                >
                  <SelectTrigger className="h-11 w-full">
                    <span className="flex items-center gap-2">
                      <Clock className="size-4 text-text-secondary" aria-hidden="true" />
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {REMINDER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {reminders.length > 1 && (
                  <button
                    type="button"
                    className="text-text-secondary hover:text-error"
                    onClick={() => removeReminder(index)}
                    aria-label="Remove reminder"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addReminder}
              className="flex items-center gap-1.5 self-end text-sm font-semibold text-primary hover:underline"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add reminder
            </button>
          </div>
        </SettingRow>

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
            Publish Course
          </Button>
        </div>
      </div>

      {/* Success modal */}
      <Dialog open={showSuccess} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-[#c6f6d5]">
              <span className="flex size-12 items-center justify-center rounded-full bg-[#38a169]">
                <Check className="size-6 text-white" strokeWidth={3} aria-hidden="true" />
              </span>
            </span>
            <h2 className="text-xl font-bold text-foreground">Course added successfully</h2>
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
          {/* Title for accessibility (success heading shown above) */}
          <span className="sr-only">{courseTitle} published</span>
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
