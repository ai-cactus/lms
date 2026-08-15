'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { useJobStatus, type JobPollResult } from '@/hooks/use-job-status';

export type ExportScope = 'org' | 'course' | 'staff' | 'all-courses' | 'all-staff';

/** Noun the export banners count, derived from the scope by the caller. */
export type ExportEntity = 'course' | 'staff';

export interface ExportJob {
  id: string;
  label: string;
  scope: ExportScope;
  entity: ExportEntity;
  /** Rows the export covers, used for the banner headline ("Exporting 48 Courses…"). */
  count: number;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
}

interface StartArgs {
  scope: ExportScope;
  scopeId?: string;
  label: string;
  entity: ExportEntity;
  count: number;
  // Optional date-range filter (YYYY-MM-DD); threaded to the export worker so
  // the generated report only covers enrollments started within the period.
  from?: string;
  to?: string;
}

interface ExportJobsContextValue {
  jobs: ExportJob[];
  /** The single in-flight export, if any. Exports are blocked while it runs. */
  activeJob: ExportJob | null;
  /** The export that finished during this session, cleared when a new one starts. */
  completedJob: ExportJob | null;
  startExport: (args: StartArgs) => Promise<void>;
  downloadJob: (jobId: string) => void;
}

// v2: the stored shape gained `entity`/`count` for the banner headlines, so v1
// entries are deliberately abandoned rather than migrated.
const STORAGE_KEY = 'auditReportExportJobs.v2';
const ExportJobsContext = createContext<ExportJobsContextValue | null>(null);

function downloadUrl(jobId: string): string {
  return `/api/auditor/export/${jobId}/download?format=csv`;
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
  // Which finished job the success banner is showing. Session-scoped on purpose:
  // a restored job from a previous visit must not resurrect a stale banner.
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);
  // Job IDs that have already been finalized so we never settle twice (guards
  // against StrictMode double-mounts and repeat terminal observations).
  const finalizedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setJobs(JSON.parse(raw) as ExportJob[]);
    } catch (e) {
      logger.error({ msg: '[auditor] Failed to load export jobs', err: e });
    }
  }, []);

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

    if (outcome === 'completed') {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: 'completed', progress: 100 } : j)),
      );
      setCompletedJobId(jobId);
      return;
    }

    setJobs((prev) => {
      const label = prev.find((j) => j.id === jobId)?.label ?? 'Export';
      toast.error(`${label} failed`, { description: 'Please try again.' });
      return prev.map((j) => (j.id === jobId ? { ...j, status: 'failed' } : j));
    });
  }, []);

  const startExport = useCallback(async (args: StartArgs) => {
    const { entity, count, ...payload } = args;
    try {
      const res = await fetch('/api/auditor/export/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Start failed (${res.status})`);
      const data = (await res.json()) as { jobId: string };
      setCompletedJobId(null);
      setJobs((prev) => [
        ...prev,
        {
          id: data.jobId,
          label: args.label,
          scope: args.scope,
          entity,
          count,
          status: 'processing',
          progress: 0,
        },
      ]);
    } catch (e) {
      logger.error({ msg: '[auditor] Failed to start export', err: e });
      toast.error('Could not start export', { description: 'Please try again.' });
    }
  }, []);

  const value = useMemo<ExportJobsContextValue>(() => {
    const activeJob = jobs.find((j) => j.status === 'processing') ?? null;
    const completedJob =
      (completedJobId && jobs.find((j) => j.id === completedJobId && j.status === 'completed')) ||
      null;
    return { jobs, activeJob, completedJob, startExport, downloadJob };
  }, [jobs, completedJobId, startExport, downloadJob]);

  return (
    <ExportJobsContext.Provider value={value}>
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
