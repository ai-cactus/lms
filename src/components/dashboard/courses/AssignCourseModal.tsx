'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Mail, Upload, Download, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import DatePicker from '@/components/ui/DatePicker';
import { assignCourseToUsers } from '@/app/actions/course';
import {
  readStaffSpreadsheetRows,
  extractStaffEmailsFromRows,
  buildStaffCsvTemplate,
} from '@/lib/staff-csv';
import { parseEmailList } from '@/lib/email-list';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface AssignCourseModalProps {
  courseId: string;
  courseTitle: string;
  onClose: () => void;
}

/**
 * Chips shown before the list collapses into a "+N more" summary. Keeps the
 * field at the mock's height for a bulk paste without hiding a short list.
 */
const VISIBLE_CHIP_LIMIT = 6;

export default function AssignCourseModal({
  courseId,
  courseTitle,
  onClose,
}: AssignCourseModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'warning'; text: string } | null>(null);

  const visibleEmails = useMemo(
    () => (expanded ? emails : emails.slice(0, VISIBLE_CHIP_LIMIT)),
    [emails, expanded],
  );
  const hiddenCount = emails.length - visibleEmails.length;

  const addEmails = (text: string) => {
    const { valid, invalidCount } = parseEmailList(text);
    if (valid.length > 0) {
      setEmails((prev) => [...prev, ...valid.filter((email) => !prev.includes(email))]);
    }
    setNotice(
      invalidCount > 0
        ? {
            type: 'warning',
            text: `${invalidCount} entr${invalidCount === 1 ? 'y was' : 'ies were'} skipped — not a valid email address.`,
          }
        : null,
    );
    return invalidCount === 0;
  };

  const commitDraft = () => {
    if (!draft.trim()) return;
    if (addEmails(draft)) setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      commitDraft();
      return;
    }
    if (e.key === 'Backspace' && !draft && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    addEmails(e.clipboardData.getData('text'));
    setDraft('');
  };

  const removeEmail = (email: string) => {
    setEmails((prev) => prev.filter((e) => e !== email));
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildStaffCsvTemplate()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'assign-course-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setNotice(null);
    try {
      const rows = await readStaffSpreadsheetRows(file);
      const parsed = extractStaffEmailsFromRows(rows);

      if (parsed.validEmails.length === 0) {
        setNotice({
          type: 'error',
          text: 'No valid email rows found in the file. Check the format or download the sample template.',
        });
        return;
      }

      setEmails((prev) => [
        ...prev,
        ...parsed.validEmails.filter((email) => !prev.includes(email)),
      ]);

      if (parsed.invalidCount > 0 || parsed.truncated) {
        const parts: string[] = [];
        if (parsed.invalidCount > 0) parts.push(`${parsed.invalidCount} row(s) skipped`);
        if (parsed.truncated) parts.push('the file was truncated to the first 1000 rows');
        setNotice({ type: 'warning', text: `${parts.join(' and ')}.` });
      }
    } catch (err) {
      logger.error({ msg: '[course] Assign-course CSV parse failed', err, courseId });
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to parse the uploaded file.',
      });
    } finally {
      setIsParsing(false);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleSubmit = async () => {
    if (emails.length === 0) return;
    setIsSubmitting(true);
    setNotice(null);
    try {
      const result = await assignCourseToUsers(courseId, emails, dueDate || null);

      if (!result.success) {
        setNotice({
          type: 'error',
          text:
            result.message ??
            'None of these emails belong to an active member of your organization.',
        });
        return;
      }

      if (result.notFound.length > 0) {
        setNotice({
          type: 'warning',
          text: `Assigned to ${result.count} staff. Not an active member of your organization: ${result.notFound.join(', ')}.`,
        });
        router.refresh();
        return;
      }

      router.refresh();
      onClose();
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to assign the course.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[612px]"
        onInteractOutside={(e) => {
          // The deadline DatePicker portals its calendar to <body>, so picking a
          // day reads as an "outside" interaction — keep the modal open.
          const target = e.target as HTMLElement | null;
          if (target?.closest('#date-picker-popover')) e.preventDefault();
        }}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-lg font-semibold text-foreground">
              Assign course
            </DialogTitle>
            <DialogDescription className="text-sm text-text-secondary">
              {courseTitle} · Global — staff in every facility can be assigned.
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="assign-course-emails" className="text-sm font-medium text-foreground">
              Assign by email
            </label>
            <div
              onClick={() => emailInputRef.current?.focus()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                'flex min-h-[104px] w-full cursor-text flex-wrap content-start items-start gap-2 rounded-[10px] border bg-background p-3 transition-colors',
                'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
                isDragging ? 'border-primary bg-primary/5' : 'border-input',
              )}
            >
              {emails.length === 0 && (
                <Mail className="mt-1.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
              )}

              {visibleEmails.map((email) => (
                <span
                  key={email}
                  className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background-secondary px-2.5 py-1 text-sm text-foreground"
                >
                  <span className="truncate">{email}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeEmail(email);
                    }}
                    className="shrink-0 text-text-secondary transition-colors hover:text-error"
                    aria-label={`Remove ${email}`}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              ))}

              {hiddenCount > 0 && (
                <span className="flex items-center gap-1.5 rounded-md border border-border bg-background-secondary px-2.5 py-1 text-sm text-foreground">
                  +{hiddenCount} more
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(true);
                    }}
                    className="shrink-0 text-text-secondary transition-colors hover:text-foreground"
                    aria-label={`Show all ${emails.length} emails`}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              )}

              <input
                id="assign-course-emails"
                ref={emailInputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={commitDraft}
                onPaste={handlePaste}
                placeholder={
                  emails.length === 0
                    ? 'Enter emails separated by commas, spaces, or new lines'
                    : ''
                }
                className="min-w-[140px] flex-1 border-none bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-text-secondary"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsing}
              className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-primary disabled:opacity-60"
            >
              <Upload className="size-4" aria-hidden="true" />
              {isParsing ? 'Parsing…' : 'Click to upload .csv file instead'}
            </button>
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <Download className="size-4" aria-hidden="true" />
              Download sample .csv template
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onFileInputChange}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">
              Completion deadline (optional)
            </span>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              placeholder="Select a date"
              label="Completion deadline"
              iconPosition="start"
              showYearSelect
              placement="top-end"
              className="h-11"
            />
          </div>

          {notice && (
            <Alert variant={notice.type === 'error' ? 'error' : 'warning'}>{notice.text}</Alert>
          )}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              loading={isSubmitting}
              disabled={emails.length === 0}
            >
              {`Assign to ${emails.length} staff`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
