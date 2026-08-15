'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/logger';
import type { JobStatus } from '@/types/job';
import type { JobPollResult } from './use-job-status';

/** State of one module's generation job. */
export interface MultiJobState<T> {
  moduleIndex: number;
  jobId?: string;
  status?: JobStatus;
  result?: T;
  error?: string;
}

/**
 * Aggregate progress across every module's job, driving the staged checklist on
 * the generation screen. The fourth checklist item (aggregating the finished
 * modules into one course) is the caller's own work and is not tracked here.
 */
export interface MultiJobProgress {
  /** Every module has a job on the server. */
  jobsCreated: boolean;
  /** Every job has left the queue — processing, or already finished. */
  allStarted: boolean;
  /** Every job finished successfully. */
  allCompleted: boolean;
}

export interface MultiJobCreateResult {
  moduleIndex: number;
  jobId?: string;
  error?: string;
}

export interface UseMultiJobStatusOptions<T> {
  /** Module positions to generate, in course order. */
  moduleIndexes: number[];
  /**
   * Jobs already running from an earlier visit. When supplied, the first run
   * resumes them instead of creating a second, duplicate set.
   */
  initialJobs?: { moduleIndex: number; jobId: string }[];
  /**
   * Creates jobs for the given modules. Called once for the whole batch on the
   * first run, and again with a single module on a scoped retry.
   */
  createJobs: (moduleIndexes: number[]) => Promise<MultiJobCreateResult[]>;
  /** Fetches one job's current status. */
  poll: (jobId: string) => Promise<JobPollResult<T>>;
  /** Fired once, when every module has completed, in module order. */
  onAllCompleted?: (results: { moduleIndex: number; result: T }[]) => void;
  /** Fired whenever a batch of jobs is created, for persistence/resume. */
  onJobsCreated?: (jobs: { moduleIndex: number; jobId: string }[]) => void;
  intervalMs?: number;
  maxPollMs?: number;
  enabled?: boolean;
  /** User-safe message for a stop condition with no better message of its own. */
  fallbackError?: string;
}

export interface UseMultiJobStatusResult<T> {
  jobs: MultiJobState<T>[];
  progress: MultiJobProgress;
  /** Modules whose job terminally failed — each retryable on its own. */
  failedModules: MultiJobState<T>[];
  /** Set only when the whole run cannot proceed (nothing left in flight). */
  error?: string;
  retryModule: (moduleIndex: number) => void;
  retryAll: () => void;
}

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_MAX_POLL_MS = 11 * 60 * 1000;
const DEFAULT_FALLBACK_ERROR = 'Something went wrong. Please try again.';

function isTerminal<T>(job: MultiJobState<T>): boolean {
  return job.status === 'completed' || job.status === 'failed' || !!job.error;
}

/**
 * Polls one generation job per module and reduces them to the aggregate phases
 * the multi-module generation screen renders.
 *
 * It keeps the same contract as {@link useJobStatus} for a single job — the
 * poll cadence, the wall-clock backstop so the UI can never spin forever, the
 * `failed`-wins-over-raw-`error` precedence that keeps sanitized copy in front
 * of the user, and unmount cleanup — but tracks N jobs on one timer and lets a
 * single failed module be retried without disturbing the others.
 */
export function useMultiJobStatus<T>({
  moduleIndexes,
  initialJobs,
  createJobs,
  poll,
  onAllCompleted,
  onJobsCreated,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxPollMs = DEFAULT_MAX_POLL_MS,
  enabled = true,
  fallbackError = DEFAULT_FALLBACK_ERROR,
}: UseMultiJobStatusOptions<T>): UseMultiJobStatusResult<T> {
  const [jobs, setJobs] = useState<MultiJobState<T>[]>(() =>
    moduleIndexes.map((moduleIndex) => ({
      moduleIndex,
      jobId: initialJobs?.find((job) => job.moduleIndex === moduleIndex)?.jobId,
    })),
  );
  // Mirrors the published state so the long-lived interval never works from a
  // stale render closure.
  const jobsRef = useRef<MultiJobState<T>[]>(jobs);
  const [error, setError] = useState<string | undefined>(undefined);
  const [startNonce, setStartNonce] = useState(0);

  const createJobsRef = useRef(createJobs);
  const pollRef = useRef(poll);
  const onAllCompletedRef = useRef(onAllCompleted);
  const onJobsCreatedRef = useRef(onJobsCreated);
  const intervalMsRef = useRef(intervalMs);
  const maxPollMsRef = useRef(maxPollMs);
  const fallbackErrorRef = useRef(fallbackError);
  useEffect(() => {
    createJobsRef.current = createJobs;
    pollRef.current = poll;
    onAllCompletedRef.current = onAllCompleted;
    onJobsCreatedRef.current = onJobsCreated;
    intervalMsRef.current = intervalMs;
    maxPollMsRef.current = maxPollMs;
    fallbackErrorRef.current = fallbackError;
  });

  const hasStartedRef = useRef(false);
  // Modules whose job creation is in flight, so it is never started twice.
  const creatingRef = useRef<Set<number>>(new Set());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const completionNotifiedRef = useRef(false);

  const commit = useCallback((next: MultiJobState<T>[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const settleIfDone = useCallback(() => {
    const current = jobsRef.current;
    if (!current.every(isTerminal)) return;

    stopPolling();

    const completed = current.filter(
      (job) => job.status === 'completed' && job.result !== undefined,
    );
    if (completed.length === current.length && !completionNotifiedRef.current) {
      completionNotifiedRef.current = true;
      onAllCompletedRef.current?.(
        [...completed]
          .sort((a, b) => a.moduleIndex - b.moduleIndex)
          .map((job) => ({ moduleIndex: job.moduleIndex, result: job.result as T })),
      );
    }
  }, [stopPolling]);

  const pollOnce = useCallback(async () => {
    // Client-side backstop — never poll forever.
    if (Date.now() - startedAtRef.current > maxPollMsRef.current) {
      stopPolling();
      commit(
        jobsRef.current.map((job) =>
          isTerminal(job)
            ? job
            : { ...job, status: 'failed' as JobStatus, error: fallbackErrorRef.current },
        ),
      );
      settleIfDone();
      return;
    }

    const inFlight = jobsRef.current.filter((job) => job.jobId && !isTerminal(job));
    if (inFlight.length === 0) {
      settleIfDone();
      return;
    }

    const outcomes = await Promise.all(
      inFlight.map(async (job) => ({
        moduleIndex: job.moduleIndex,
        res: await pollRef.current(job.jobId as string),
      })),
    );

    let next = jobsRef.current;
    for (const { moduleIndex, res } of outcomes) {
      // `failed` takes precedence over a raw `error` so the sanitized,
      // user-safe message always wins over any leaked detail.
      let changes: Partial<MultiJobState<T>>;
      if (res.status === 'failed') {
        changes = { status: 'failed', error: res.error || fallbackErrorRef.current };
      } else if (res.status === 'completed' && res.result !== undefined) {
        changes = { status: 'completed', result: res.result };
      } else if (res.error) {
        // Non-terminal check error (e.g. job not found) — show safe copy.
        changes = { status: 'failed', error: fallbackErrorRef.current };
      } else if (res.status) {
        changes = { status: res.status };
      } else {
        continue;
      }
      next = next.map((job) => (job.moduleIndex === moduleIndex ? { ...job, ...changes } : job));
    }
    commit(next);
    settleIfDone();
  }, [commit, settleIfDone, stopPolling]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    startedAtRef.current = Date.now();
    pollTimerRef.current = setInterval(() => {
      pollOnce().catch((pollErr) =>
        logger.error({ msg: '[jobs] Multi-job polling failed', err: pollErr }),
      );
    }, intervalMsRef.current);
  }, [pollOnce]);

  const createFor = useCallback(
    async (targets: number[]) => {
      // Creation is in flight for the whole batch before any jobId lands in
      // state, so a second start pass (React StrictMode's simulated remount)
      // would otherwise start a duplicate job for every module.
      const pending = targets.filter((moduleIndex) => !creatingRef.current.has(moduleIndex));
      if (pending.length === 0) return false;
      for (const moduleIndex of pending) creatingRef.current.add(moduleIndex);

      let created: MultiJobCreateResult[];
      try {
        created = await createJobsRef.current(pending);
      } finally {
        for (const moduleIndex of pending) creatingRef.current.delete(moduleIndex);
      }

      let next = jobsRef.current;
      for (const job of created) {
        next = next.map((existing) =>
          existing.moduleIndex === job.moduleIndex
            ? {
                ...existing,
                jobId: job.jobId,
                // A module that never started is terminal until it is retried.
                status: job.jobId ? existing.status : ('failed' as JobStatus),
                error: job.jobId ? undefined : job.error || fallbackErrorRef.current,
              }
            : existing,
        );
      }
      commit(next);

      const startedJobs = created
        .filter((job) => job.jobId)
        .map((job) => ({ moduleIndex: job.moduleIndex, jobId: job.jobId as string }));
      if (startedJobs.length > 0) {
        onJobsCreatedRef.current?.(
          jobsRef.current
            .filter((job) => job.jobId)
            .map((job) => ({ moduleIndex: job.moduleIndex, jobId: job.jobId as string })),
        );
      }

      return startedJobs.length > 0;
    },
    [commit],
  );

  useEffect(() => {
    if (!enabled) return;
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const start = async () => {
      try {
        const pending = jobsRef.current.filter((job) => !job.jobId).map((job) => job.moduleIndex);

        // A resumed run already has its jobs — poll them straight away.
        if (pending.length > 0) {
          const anyStarted = await createFor(pending);
          if (!anyStarted && jobsRef.current.every(isTerminal)) {
            setError(jobsRef.current.find((job) => job.error)?.error ?? fallbackErrorRef.current);
            return;
          }
        }

        startPolling();
        // Poll immediately so a job that finished while the page was away (or a
        // resumed run) settles without waiting a full interval.
        await pollOnce();
      } catch (err) {
        logger.error({ msg: '[jobs] Multi-job start failed', err });
        setError(fallbackErrorRef.current);
      }
    };

    start();

    // Teardown clears the single-start guard as well, so a StrictMode
    // simulated-unmount re-arms polling instead of leaving it dead in dev.
    return () => {
      stopPolling();
      hasStartedRef.current = false;
    };
  }, [enabled, startNonce, createFor, pollOnce, startPolling, stopPolling]);

  const restart = useCallback(
    (targets: number[]) => {
      stopPolling();
      hasStartedRef.current = false;
      startedAtRef.current = 0;
      completionNotifiedRef.current = false;
      setError(undefined);
      commit(
        jobsRef.current.map((job) =>
          targets.includes(job.moduleIndex)
            ? {
                moduleIndex: job.moduleIndex,
                jobId: undefined,
                status: undefined,
                error: undefined,
              }
            : job,
        ),
      );
      setStartNonce((n) => n + 1);
    },
    [commit, stopPolling],
  );

  const retryModule = useCallback((moduleIndex: number) => restart([moduleIndex]), [restart]);
  const retryAll = useCallback(
    () => restart(jobsRef.current.map((job) => job.moduleIndex)),
    [restart],
  );

  const jobsCreated = jobs.length > 0 && jobs.every((job) => !!job.jobId);
  const allStarted =
    jobsCreated && jobs.every((job) => job.status === 'processing' || job.status === 'completed');
  const allCompleted = jobs.length > 0 && jobs.every((job) => job.status === 'completed');

  return {
    jobs,
    progress: { jobsCreated, allStarted, allCompleted },
    failedModules: jobs.filter((job) => job.status === 'failed' || job.error),
    error,
    retryModule,
    retryAll,
  };
}
