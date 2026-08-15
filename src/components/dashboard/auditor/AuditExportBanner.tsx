'use client';

import { CheckCircle2, FileText, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExportJobs, type ExportEntity } from './ExportJobsProvider';

/** "Staff" is already collective, but the design counts staff rows as "Staffs". */
const PLURAL: Record<ExportEntity, string> = { course: 'Courses', staff: 'Staffs' };
const SINGULAR: Record<ExportEntity, string> = { course: 'Course', staff: 'Staff' };

function scopeLabel(entity: ExportEntity, count: number): string {
  return `${count} ${count === 1 ? SINGULAR[entity] : PLURAL[entity]}`;
}

function reportLabel(entity: ExportEntity, count: number): string {
  return `${count} ${SINGULAR[entity]} Report${count === 1 ? '' : 's'}`;
}

/**
 * Status banner for the Audit Reports export flow. Sits above the page header and
 * shows the single in-flight export, then the finished one until the next export
 * starts. Renders nothing when neither exists.
 */
export default function AuditExportBanner() {
  const { activeJob, completedJob, downloadJob } = useExportJobs();

  if (activeJob) {
    return (
      <div
        className="mb-8 flex flex-col items-start gap-3 rounded-[12px] border border-primary/15 bg-primary/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            aria-hidden="true"
          >
            <Loader2 className="size-[18px] animate-spin" />
          </span>
          <div className="text-sm">
            <p className="font-bold text-primary">
              Exporting {scopeLabel(activeJob.entity, activeJob.count)}...
            </p>
            <p className="text-text-secondary">
              Your CSV will be ready shortly. Please do not close this tab.
            </p>
          </div>
        </div>

        <Button
          type="button"
          disabled
          className="h-10 shrink-0 gap-2 self-stretch rounded-[8px] px-4 text-sm font-semibold disabled:opacity-100 sm:self-auto"
        >
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          Processing...
        </Button>
      </div>
    );
  }

  if (!completedJob) return null;

  return (
    <div
      className="mb-8 flex flex-col items-start gap-3 rounded-[12px] border border-success/20 bg-success/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success text-white"
          aria-hidden="true"
        >
          <CheckCircle2 className="size-[18px]" />
        </span>
        <div className="text-sm">
          <p className="font-bold text-success">
            Exported {reportLabel(completedJob.entity, completedJob.count)}
          </p>
          <p className="text-text-secondary">Your audit report is ready.</p>
        </div>
      </div>

      <Button
        type="button"
        className="h-10 shrink-0 gap-2 self-stretch rounded-[8px] bg-success px-4 text-sm font-semibold text-white hover:bg-success/90 sm:self-auto"
        onClick={() => downloadJob(completedJob.id)}
      >
        <FileText className="size-4" aria-hidden="true" />
        View Report
      </Button>
    </div>
  );
}
