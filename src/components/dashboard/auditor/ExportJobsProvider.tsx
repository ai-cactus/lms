'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

export type ExportScope = 'org' | 'course' | 'staff';

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

export function ExportJobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Poll any in-flight jobs.
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'processing');
    if (!hasActive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return; // already polling

    pollRef.current = setInterval(async () => {
      const active = jobs.filter((j) => j.status === 'processing');
      await Promise.all(
        active.map(async (job) => {
          try {
            const res = await fetch(`/api/auditor/export/${job.id}/status`);
            if (!res.ok) return;
            const data = (await res.json()) as { status: string; progress: number };

            if (data.status === 'completed') {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? { ...j, status: 'completed', progress: 100, downloaded: true }
                    : j,
                ),
              );
              triggerBrowserDownload(job.id);
              toast.success(`${job.label} is ready`, {
                description: 'Your PDF has been downloaded.',
                action: { label: 'Download again', onClick: () => triggerBrowserDownload(job.id) },
                duration: 10000,
              });
            } else if (data.status === 'failed') {
              setJobs((prev) =>
                prev.map((j) => (j.id === job.id ? { ...j, status: 'failed' } : j)),
              );
              toast.error(`${job.label} failed`, { description: 'Please try again.' });
            } else {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id ? { ...j, progress: data.progress ?? j.progress } : j,
                ),
              );
            }
          } catch (e) {
            logger.error({ msg: 'Export poll error', err: e });
          }
        }),
      );
    }, 1500);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobs]);

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
      {children}
    </ExportJobsContext.Provider>
  );
}

export function useExportJobs(): ExportJobsContextValue {
  const ctx = useContext(ExportJobsContext);
  if (!ctx) throw new Error('useExportJobs must be used within ExportJobsProvider');
  return ctx;
}
