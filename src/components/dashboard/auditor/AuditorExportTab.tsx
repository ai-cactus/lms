'use client';

import { FileText, Download, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExportJobs } from './ExportJobsProvider';
import { useAuditFilter, toRangeInput } from './AuditFilterProvider';

export default function AuditorExportTab() {
  const { jobs, startExport, downloadJob } = useExportJobs();
  const { range } = useAuditFilter();

  // Most recent jobs first.
  const recent = [...jobs].reverse();
  const activeOrg = recent.find((j) => j.scope === 'org' && j.status === 'processing');
  const latestCompletedOrg = recent.find((j) => j.scope === 'org' && j.status === 'completed');

  return (
    <div className="rounded-xl border border-border bg-background p-6">
      <div className="mb-5">
        <h2 className="text-base font-bold text-foreground">System Bulk Export</h2>
      </div>

      <div className="flex flex-col items-center justify-center px-6 py-14">
        <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
          <FileText className="size-10 text-primary" aria-hidden="true" />
        </div>
        <p className="mt-3 text-lg font-bold text-foreground">Generate Full Organization Report</p>
        <p className="mt-1 max-w-[460px] text-center text-sm text-text-secondary">
          Compiles all staffing, compliance, and material evidence into a formatted PDF. It
          downloads automatically when ready — you can keep working in the meantime.
        </p>

        <Button
          className="mt-5"
          disabled={!!activeOrg}
          onClick={() =>
            startExport({ scope: 'org', label: 'Organization report', ...toRangeInput(range) })
          }
        >
          {activeOrg ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Generating… {activeOrg.progress}%
            </>
          ) : (
            <>
              <Download className="size-4" aria-hidden="true" />
              Export PDF
            </>
          )}
        </Button>

        {latestCompletedOrg && (
          <div className="mt-4 flex items-center gap-3 text-sm text-text-secondary">
            <span>Need another format?</span>
            <a
              href={`/api/auditor/export/${latestCompletedOrg.id}/download?format=csv`}
              className="font-semibold text-primary hover:underline"
              download
            >
              CSV
            </a>
            <a
              href={`/api/auditor/export/${latestCompletedOrg.id}/download?format=docx`}
              className="font-semibold text-primary hover:underline"
              download
            >
              DOCX
            </a>
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="border-t border-border pt-5">
          <h3 className="mb-3 text-sm font-bold text-foreground">Recent exports</h3>
          <ul className="flex flex-col gap-2">
            {recent.slice(0, 10).map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  {job.status === 'completed' ? (
                    <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  ) : job.status === 'failed' ? (
                    <span className="text-xs font-semibold text-destructive">Failed</span>
                  ) : (
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                  )}
                  <span className="text-sm text-foreground">{job.label}</span>
                  {job.status === 'processing' && (
                    <span className="text-xs text-text-tertiary">{job.progress}%</span>
                  )}
                </div>
                {job.status === 'completed' && (
                  <button
                    type="button"
                    onClick={() => downloadJob(job.id)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    Download
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
