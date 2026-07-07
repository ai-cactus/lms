'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { useJobStatus, type JobPollResult } from '@/hooks/use-job-status';

export type ExportScope = 'org' | 'course' | 'staff' | 'all-courses' | 'all-staff';

export interface ExportJob {
  id: string;
  label: string;
  scope: ExportScope;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  downloaded: boolean;
}

interface StartArgs {
  scope: ExportScope;
  scopeId?: string;
  label: string;
  // Optional date-range filter (YYYY-MM-DD); threaded to the export worker so
  // the generated report only covers enrollments started within the period.
  from?: string;
  to?: string;
}

interface ExportJobsContextValue {
  jobs: ExportJob[];
  startExport: (args: StartArgs) => Promise<void>;
  downloadJob: (jobId: string) => void;
}

const STORAGE_KEY = 'auditReportExportJobs';
const ExportJobsContext = createContext<ExportJobsContextValue | null>(null);

function downloadUrl(jobId: string): string {
  return `/api/auditor/export/${jobId}/download?format=pdf`;
}

function triggerBrowserDownload(jobId: string) {
  const a = document.createElement('a');
  a.href = downloadUrl(jobId);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Shape returned by the export status endpoint that we care about. */
interface ExportStatusResponse {
  status: string;
  progress: number;
}

/** Poll cadence for export jobs (ms) — matches the provider's original 1.5s. */
const EXPORT_POLL_INTERVAL_MS = 1500;

/**
 * Headless per-job watcher: mounts one {@link useJobStatus} per active export
 * job and reports progress/completion/failure back up to the provider. Rendering
 * one watcher per in-flight job lets the provider track many jobs at once while
 * reusing the shared poller's cadence, wall-clock cap, StrictMode guard, and
 * unmount cleanup instead of a bespoke `setInterval`.
 */
function ExportJobWatcher({
  jobId,
  onProgress,
  onSettled,
}: {
  jobId: string;
  onProgress: (jobId: string, progress: number) => void;
  onSettled: (jobId: string, outcome: 'completed' | 'failed') => void;
}) {
  const poll = useCallback(async (): Promise<JobPollResult<ExportStatusResponse>> => {
    const res = await fetch(`/api/auditor/export/${jobId}/status`);
    // Transient fetch failure — skip this tick and keep polling, as before.
    if (!res.ok) return { status: 'processing' };

    const data = (await res.json()) as ExportStatusResponse;
    if (data.status === 'completed') return { status: 'completed', result: data };
    if (data.status === 'failed') return { status: 'failed' };

    // Still in flight — surface progress and keep polling.
    onProgress(jobId, data.progress);
    return { status: 'processing' };
  }, [jobId, onProgress]);

  const { status, error } = useJobStatus<ExportStatusResponse>({
    poll,
    intervalMs: EXPORT_POLL_INTERVAL_MS,
    onCompleted: () => onSettled(jobId, 'completed'),
  });

  // A `failed` status or a terminal hook error (e.g. the poll-cap timeout) both
  // resolve the job as failed. The provider dedupes so this fires effects once.
  useEffect(() => {
    if (status === 'failed' || error) onSettled(jobId, 'failed');
  }, [status, error, jobId, onSettled]);

  return null;
}

export function ExportJobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  // Latest jobs snapshot so the finalize callbacks can read a job's label
  // without re-subscribing (avoids a stale closure).
  const jobsRef = useRef<ExportJob[]>(jobs);
  // Job IDs that have already been downloaded/toasted so we never fire twice
  // (guards against StrictMode double-mounts and repeat terminal observations).
  const finalizedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // Load persisted jobs on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setJobs(JSON.parse(raw) as ExportJob[]);
    } catch (e) {
      logger.error({ msg: 'Failed to load export jobs', err: e });
    }
  }, []);

  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(-20)));
    } catch {
      /* ignore quota errors */
    }
  }, [jobs]);

  const downloadJob = useCallback((jobId: string) => {
    triggerBrowserDownload(jobId);
  }, []);

  // Live per-job progress from the watchers.
  const handleProgress = useCallback((jobId: string, progress: number) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, progress: progress ?? j.progress } : j)),
    );
  }, []);

  // Finalize a job exactly once — the guard survives StrictMode double-mounts and
  // any repeat terminal observation across watcher remounts.
  const handleSettled = useCallback((jobId: string, outcome: 'completed' | 'failed') => {
    if (finalizedRef.current.has(jobId)) return;
    finalizedRef.current.add(jobId);

    const label = jobsRef.current.find((j) => j.id === jobId)?.label ?? 'Export';

    if (outcome === 'completed') {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'completed', progress: 100, downloaded: true } : j,
        ),
      );
      triggerBrowserDownload(jobId);
      toast.success(`${label} is ready`, {
        description: 'Your PDF has been downloaded.',
        action: {
          label: 'Download again',
          onClick: () => triggerBrowserDownload(jobId),
        },
        duration: 10000,
      });
    } else {
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'failed' } : j)));
      toast.error(`${label} failed`, { description: 'Please try again.' });
    }
  }, []);

  const startExport = useCallback(async (args: StartArgs) => {
    try {
      toast.loading(`Preparing ${args.label}…`, {
        id: `start-${args.scopeId ?? args.scope}`,
        duration: 2000,
      });
      const res = await fetch('/api/auditor/export/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(`Start failed (${res.status})`);
      const data = (await res.json()) as { jobId: string };
      setJobs((prev) => [
        ...prev,
        {
          id: data.jobId,
          label: args.label,
          scope: args.scope,
          status: 'processing',
          progress: 0,
          downloaded: false,
        },
      ]);
      toast.success('Export started', {
        description: 'We will download it automatically when ready.',
      });
    } catch (e) {
      logger.error({ msg: 'Failed to start export', err: e });
      toast.error('Could not start export', { description: 'Please try again.' });
    }
  }, []);

  return (
    <ExportJobsContext.Provider value={{ jobs, startExport, downloadJob }}>
      {jobs
        .filter((j) => j.status === 'processing')
        .map((j) => (
          <ExportJobWatcher
            key={j.id}
            jobId={j.id}
            onProgress={handleProgress}
            onSettled={handleSettled}
          />
        ))}
      {children}
    </ExportJobsContext.Provider>
  );
}

export function useExportJobs(): ExportJobsContextValue {
  const ctx = useContext(ExportJobsContext);
  if (!ctx) throw new Error('useExportJobs must be used within ExportJobsProvider');
  return ctx;
}
