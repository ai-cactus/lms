'use client';

import {
  FileText,
  FileSpreadsheet,
  Download,
  Loader2,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useExportJobs } from './ExportJobsProvider';
import { useAuditFilter, toRangeInput } from './AuditFilterProvider';
import {
  auditCard,
  auditCardHeader,
  auditCardTitle,
  auditCell,
  auditHead,
  auditHeaderGroup,
  auditRow,
} from './audit-ui';
import { cn } from '@/lib/utils';

export default function AuditorExportTab() {
  const { jobs, startExport, downloadJob } = useExportJobs();
  const { range } = useAuditFilter();

  // Most recent jobs first.
  const recent = [...jobs].reverse();
  const activeOrg = recent.find((j) => j.scope === 'org' && j.status === 'processing');
  const latestCompletedOrg = recent.find((j) => j.scope === 'org' && j.status === 'completed');

  return (
    <div className="flex flex-col gap-10">
      <div className={auditCard}>
        <div className={auditCardHeader}>
          <div className="flex items-center gap-2.5">
            <FileText className="size-[18px] text-primary" aria-hidden="true" />
            <h2 className={auditCardTitle}>Create export</h2>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-6">
          {activeOrg ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="relative flex size-20 items-center justify-center rounded-full bg-[#eae7fd]">
                <RefreshCw className="size-8 animate-spin text-primary" aria-hidden="true" />
                <span
                  className="absolute right-1 top-1 size-3 rounded-full bg-primary"
                  aria-hidden
                />
              </div>
              <p className="mt-6 text-[26px] font-bold leading-9 text-[#0f172a] sm:text-[28px]">
                Generating export…
              </p>
              <p className="mt-2 max-w-[480px] text-[15px] leading-7 text-[#475569]">
                This may take a few minutes. Please stay on this page to ensure your download starts
                automatically when ready.
              </p>

              <div className="mt-8 w-full max-w-[750px] text-left">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[12px] font-bold uppercase tracking-[0.24px] text-primary">
                      Status
                    </p>
                    <p className="text-[14px] leading-5 text-[#0f172a]">
                      Processing database records
                    </p>
                  </div>
                  <p className="text-[20px] font-bold leading-6 text-primary">
                    {activeOrg.progress}%
                  </p>
                </div>
                <div
                  className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#e2e8f0]"
                  role="progressbar"
                  aria-valuenow={activeOrg.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${activeOrg.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ) : latestCompletedOrg ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex size-20 items-center justify-center rounded-full bg-[#dcfce7]">
                <CheckCircle2 className="size-10 text-[#16a34a]" aria-hidden="true" />
              </div>
              <p className="mt-5 text-[26px] font-bold leading-9 text-[#0f172a] sm:text-[28px]">
                Export Ready
              </p>
              <p className="mt-2 max-w-[480px] text-[15px] leading-7 text-[#475569]">
                Your export has been successfully processed and is now available for download.
              </p>
              <div className="mt-7 flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
                <Button
                  asChild
                  className="h-[52px] gap-2 rounded-[8px] px-6 text-[15.5px] font-semibold sm:w-[300px]"
                >
                  <a
                    href={`/api/auditor/export/${latestCompletedOrg.id}/download?format=docx`}
                    download
                  >
                    <FileText className="size-[18px]" aria-hidden="true" />
                    Download .docx
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-[52px] gap-2 rounded-[8px] border-[#c7cdfa] px-6 text-[15.5px] font-semibold text-primary hover:text-primary sm:w-[300px]"
                >
                  <a
                    href={`/api/auditor/export/${latestCompletedOrg.id}/download?format=csv`}
                    download
                  >
                    <FileSpreadsheet className="size-[18px]" aria-hidden="true" />
                    Download CSV
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <p className="max-w-[720px] text-[14px] leading-6 text-[#475569]">
              Compiles all staffing, compliance, and material evidence into a formatted PDF. It
              downloads automatically when ready — you can keep working in the meantime.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t border-[#f1f5f9] bg-[#f8fafc] px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6">
          <p className="max-w-[330px] text-[13px] leading-5 text-[#64748b]">
            Generating this export may take a while depending on the scope selected.
          </p>
          <Button
            className="h-[42px] shrink-0 gap-2 rounded-[8px] px-6 text-[15px] font-semibold"
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
        </div>
      </div>

      {recent.length > 0 && (
        <div className={auditCard}>
          <div className={auditCardHeader}>
            <h2 className={auditCardTitle}>Export History</h2>
          </div>

          <Table>
            <TableHeader className={auditHeaderGroup}>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead className={cn(auditHead, 'hidden sm:table-cell sm:w-[260px]')}>
                  Export ID
                </TableHead>
                <TableHead className={cn(auditHead, 'w-full sm:w-auto')}>Report</TableHead>
                <TableHead className={cn(auditHead, 'hidden md:table-cell md:w-[180px]')}>
                  Status
                </TableHead>
                <TableHead className={cn(auditHead, 'w-[140px]')}>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.slice(0, 10).map((job) => (
                <TableRow key={job.id} className={auditRow}>
                  <TableCell
                    className={cn(auditCell, 'hidden font-mono text-primary sm:table-cell')}
                  >
                    <span className="block max-w-[220px] truncate">#{job.id}</span>
                  </TableCell>
                  <TableCell className={auditCell}>
                    <span className="block truncate text-[15.5px] font-medium tracking-[0.31px] text-[#1e1e1e]">
                      {job.label}
                    </span>
                  </TableCell>
                  <TableCell className={cn(auditCell, 'hidden md:table-cell')}>
                    {job.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#eafdf5] px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.24px] text-[#308242]">
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        Complete
                      </span>
                    ) : job.status === 'failed' ? (
                      <span className="inline-flex items-center rounded-[6px] bg-[#fdeaea] px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.24px] text-[#cd1515]">
                        Failed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#fffad1] px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.24px] text-[#d8651e]">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        {job.progress}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={auditCell}>
                    {job.status === 'completed' && (
                      <button
                        type="button"
                        onClick={() => downloadJob(job.id)}
                        className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-primary hover:underline"
                      >
                        <Download className="size-3.5" aria-hidden="true" />
                        Download
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
