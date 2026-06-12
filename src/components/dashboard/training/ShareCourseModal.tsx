'use client';

import React from 'react';
import { Mail, X, PlusCircle, Calendar } from 'lucide-react';
import { enrollUsers } from '@/app/actions/enrollment';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { logger } from '@/lib/logger';
import type { StaffEntry } from '@/types/enrollment';

interface ShareCourseModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
}

export default function ShareCourseModal({ isOpen, onClose, courseId }: ShareCourseModalProps) {
  const [entries, setEntries] = React.useState<StaffEntry[]>([]);
  const [inputValue, setInputValue] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [hasDeadline, setHasDeadline] = React.useState(false);
  const [deadlineDate, setDeadlineDate] = React.useState('');
  const [result, setResult] = React.useState<{
    success: string[];
    alreadyEnrolled: string[];
    newInvited: string[];
    failed: string[];
  } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) return;

      // Detect whether the first row is a header by checking if the last
      // column of the first row contains a valid email address.
      const firstRowCells = lines[0].split(',').map((c) => c.trim());
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const hasHeader = !emailRegex.test(firstRowCells[firstRowCells.length - 1]);
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const existingEmails = new Set(entries.map((en) => en.email.toLowerCase()));
      const newEntries: StaffEntry[] = [];

      dataLines.forEach((line) => {
        const cells = line.split(',').map((c) => c.trim());

        // Support both old single-column (email only) and new four-column format.
        // New format: First Name, Last Name, Role, Email
        let firstName: string | undefined;
        let lastName: string | undefined;
        let role: 'admin' | 'worker' | undefined;
        let email: string;

        if (cells.length >= 4) {
          firstName = cells[0] || undefined;
          lastName = cells[1] || undefined;
          const rawRole = cells[2].toLowerCase();
          role = rawRole === 'admin' ? 'admin' : 'worker';
          email = cells[3];
        } else {
          // Fallback: scan all cells for the first valid email.
          email = cells.find((c) => emailRegex.test(c)) ?? '';
        }

        if (!email || !emailRegex.test(email)) return;

        const normalizedEmail = email.toLowerCase();
        if (existingEmails.has(normalizedEmail)) return;

        existingEmails.add(normalizedEmail);
        newEntries.push({ email: normalizedEmail, firstName, lastName, role });
      });

      if (newEntries.length > 0) {
        setEntries((prev) => [...prev, ...newEntries]);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const downloadTemplate = () => {
    const rows = [
      'First Name,Last Name,Role,Email',
      'Jane,Doe,worker,jane.doe@example.com',
      'John,Smith,worker,john.smith@example.com',
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'assign_staff_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', 'Tab', ',', ' '].includes(e.key)) {
      e.preventDefault();
      const email = inputValue.trim().toLowerCase();
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (!entries.some((en) => en.email === email)) {
          setEntries((prev) => [...prev, { email }]);
        }
        setInputValue('');
      }
    } else if (e.key === 'Backspace' && !inputValue && entries.length > 0) {
      setEntries((prev) => prev.slice(0, -1));
    }
  };

  const removeEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleShare = async () => {
    if (entries.length === 0) return;

    setIsLoading(true);
    setResult(null);

    try {
      const res = await enrollUsers(courseId, entries);
      setResult(res);

      // Remove successfully processed entries from the chip list.
      const processedEmails = new Set([...res.success, ...res.newInvited]);
      if (processedEmails.size > 0) {
        setEntries((prev) => prev.filter((en) => !processedEmails.has(en.email)));
      }

      // Auto-close if all entries were successfully handled.
      if (res.success.length + res.newInvited.length === entries.length) {
        setTimeout(() => {
          onClose();
          setEntries([]);
          setResult(null);
        }, 1500);
      }
    } catch (error) {
      logger.error({ msg: '[share-course] Failed to enroll users', err: error });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign this course</DialogTitle>
          <DialogDescription>Enter one or more emails to invite to your course.</DialogDescription>
        </DialogHeader>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <div
            className="relative flex min-h-11 flex-1 flex-wrap items-center gap-1.5 rounded-md border border-border bg-background py-1.5 pr-3 pl-9 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary cursor-text"
            onClick={() => document.getElementById('email-input')?.focus()}
          >
            <Mail
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-tertiary"
              aria-hidden="true"
            />

            {entries.map((entry, index) => (
              <span
                key={index}
                className="flex items-center rounded bg-secondary px-2 py-1 text-[13px] font-medium text-foreground"
                title={
                  entry.firstName
                    ? `${entry.firstName} ${entry.lastName ?? ''}`.trim()
                    : entry.email
                }
              >
                {entry.email}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-1.5 size-auto p-0 text-text-secondary hover:bg-transparent hover:text-error"
                  onClick={() => removeEntry(index)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </span>
            ))}

            <input
              id="email-input"
              className="min-w-[120px] flex-1 border-none bg-transparent px-0 py-0.5 text-sm text-foreground outline-none"
              placeholder={entries.length === 0 ? 'Emails, comma separated' : ''}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
          </div>
          <Button
            variant="default"
            className="self-center"
            onClick={handleShare}
            disabled={entries.length === 0 || isLoading}
          >
            {isLoading ? 'Assigning...' : 'Assign'}
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-6">
          <label className="flex cursor-pointer items-center text-sm font-medium text-primary hover:underline">
            <PlusCircle className="mr-1.5 size-4" aria-hidden="true" />
            Click to upload .csv file instead
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          </label>
          <button
            className="flex items-center text-sm font-medium text-primary hover:underline"
            onClick={downloadTemplate}
          >
            Download sample .csv template
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between border-b border-bg-secondary pb-4">
          <div className="flex-1">
            <span className="mb-1 block text-base font-semibold text-foreground">
              Set Completion Deadline
            </span>
            <span className="block max-w-[90%] text-xs leading-snug text-text-secondary">
              Set a deadline for team member to complete this course
            </span>
          </div>
          <label className="relative inline-block h-6 w-11 shrink-0">
            <input
              type="checkbox"
              checked={hasDeadline}
              onChange={(e) => setHasDeadline(e.target.checked)}
              className="peer size-0 opacity-0"
            />
            <span className="absolute inset-0 cursor-pointer rounded-full bg-[#cbd5e0] transition-colors duration-300 peer-checked:bg-primary" />
            <span className="absolute bottom-0.5 left-0.5 size-4 rounded-full bg-white transition-transform duration-200 peer-checked:translate-x-4" />
          </label>
        </div>

        {hasDeadline && (
          <div className="mt-4 mb-6">
            <div className="flex items-center rounded-md border border-border bg-background px-3 py-2">
              <Calendar className="mr-2 size-[18px] text-text-tertiary" aria-hidden="true" />
              <input
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="flex-1 border-none bg-transparent text-sm text-foreground outline-none"
              />
            </div>
          </div>
        )}

        {/* Result feedback */}
        {result && (
          <div className="mb-4 flex flex-col gap-2">
            {result.success.length > 0 && (
              <Alert variant="success">Enrolled: {result.success.join(', ')}</Alert>
            )}
            {result.newInvited.length > 0 && (
              <Alert variant="info">Invited &amp; Enrolled: {result.newInvited.join(', ')}</Alert>
            )}
            {result.alreadyEnrolled.length > 0 && (
              <Alert variant="warning">Already enrolled: {result.alreadyEnrolled.join(', ')}</Alert>
            )}
            {result.failed.length > 0 && (
              <Alert variant="error">Failed: {result.failed.join(', ')}</Alert>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
