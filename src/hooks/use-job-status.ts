'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/logger';
import type { JobStatus } from '@/types/job';

/**
 * Result shape returned by a single {@link UseJobStatusOptions.poll} call.
 * Mirrors the server-side `JobResponse<T>` contract: a terminal status carries
 * a `result` (completed) or `error` (failed); a non-terminal check can also
 * return a bare `error` (e.g. the job could not be found).
 */
export interface JobPollResult<T> {
  status?: JobStatus;
  result?: T;
  error?: string;
}

export interface UseJobStatusOptions<T> {
  /**
   * Fetches the current job status. Transport-agnostic — the caller decides how
   * the status is obtained (server action, REST, etc.).
   */
  poll: () => Promise<JobPollResult<T>>;
  /**
   * Optional job-creation step run once before polling begins (and again on
   * each {@link UseJobStatusResult.retry}). Return `{ error }` to surface a
   * start failure without polling; return `void` once the job is ready to poll.
   * The hook deliberately knows nothing about how a job is created.
   */
  createJob?: () => Promise<{ error?: string } | void>;
  /** Poll cadence in milliseconds. Defaults to 3000. */
  intervalMs?: number;
  /**
   * Client-side backstop: stop polling after this long even if the job never
   * reaches a terminal state, so the UI can never spin forever. Defaults to
   * 11 minutes.
   */
  maxPollMs?: number;
  /** When false, no job is created or polled. Defaults to true. */
  enabled?: boolean;
  /**
   * User-safe message surfaced when a stop condition has no better message of
   * its own (poll-cap timeout, a `failed` status without an error, or a
   * non-terminal check error). Kept caller-supplied so this hook stays free of
   * any domain-specific copy.
   */
  fallbackError?: string;
  /** Fired once with the raw job result when the job completes. */
  onCompleted?: (result: T) => void;
}

export interface UseJobStatusResult<T> {
  /** Last status observed from {@link UseJobStatusOptions.poll}. */
  status: JobStatus | undefined;
  /** The completed job result, once available. */
  result: T | undefined;
  /** User-safe error message once the job has terminally failed or timed out. */
  error: string | undefined;
  /** Clears error state and re-runs `createJob` + polling from scratch. */
  retry: () => void;
}

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_MAX_POLL_MS = 11 * 60 * 1000;
const DEFAULT_FALLBACK_ERROR = 'Something went wrong. Please try again.';

/**
 * Transport-agnostic polling hook for background jobs. It owns the poll cadence,
 * the wall-clock poll cap, terminal-state handling, and unmount cleanup, while
 * delegating job creation and status transport to caller-provided callbacks.
 *
 * Terminal-state precedence intentionally matches the original inline poller:
 * a `failed` status wins over a raw `error` so a sanitized, user-safe message
 * always takes priority over any leaked detail.
 */
export function useJobStatus<T>({
  poll,
  createJob,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxPollMs = DEFAULT_MAX_POLL_MS,
  enabled = true,
  fallbackError = DEFAULT_FALLBACK_ERROR,
  onCompleted,
}: UseJobStatusOptions<T>): UseJobStatusResult<T> {
  const [status, setStatus] = useState<JobStatus | undefined>(undefined);
  const [result, setResult] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // Bumped by retry() to re-trigger the polling effect from scratch.
  const [startNonce, setStartNonce] = useState(0);

  // Latest option callbacks/values, read at poll time so the long-lived
  // interval never closes over stale values without forcing a re-subscribe.
  const pollRef = useRef(poll);
  const createJobRef = useRef(createJob);
  const onCompletedRef = useRef(onCompleted);
  const intervalMsRef = useRef(intervalMs);
  const maxPollMsRef = useRef(maxPollMs);
  const fallbackErrorRef = useRef(fallbackError);
  useEffect(() => {
    pollRef.current = poll;
    createJobRef.current = createJob;
    onCompletedRef.current = onCompleted;
    intervalMsRef.current = intervalMs;
    maxPollMsRef.current = maxPollMs;
    fallbackErrorRef.current = fallbackError;
  });

  // Guards against a double-start (React StrictMode / re-renders) and holds the
  // active interval so retry/unmount can cancel it cleanly.
  const hasStartedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const start = async () => {
      try {
        if (createJobRef.current) {
          const createResult = await createJobRef.current();
          if (createResult && createResult.error) {
            setError(createResult.error);
            return;
          }
        }

        startedAtRef.current = Date.now();

        pollTimerRef.current = setInterval(async () => {
          try {
            // Client-side timeout backstop — never poll forever.
            if (Date.now() - startedAtRef.current > maxPollMsRef.current) {
              stopPolling();
              setError(fallbackErrorRef.current);
              return;
            }

            const res = await pollRef.current();

            // `failed` takes precedence over a raw `error` so the sanitized,
            // user-safe message always wins over any leaked detail.
            if (res.status === 'failed') {
              stopPolling();
              setStatus('failed');
              setError(res.error || fallbackErrorRef.current);
            } else if (res.status === 'completed' && res.result !== undefined) {
              stopPolling();
              setStatus('completed');
              setResult(res.result);
              onCompletedRef.current?.(res.result);
            } else if (res.error) {
              // Non-terminal check error (e.g. job not found) — show safe copy.
              stopPolling();
              setError(fallbackErrorRef.current);
            } else if (res.status) {
              // Still in flight (queued/processing) — reflect it and keep polling.
              setStatus(res.status);
            }
          } catch (pollErr) {
            logger.error({ msg: '[jobs] Polling failed', err: pollErr });
          }
        }, intervalMsRef.current);
      } catch (err) {
        logger.error({ msg: '[jobs] Job start failed', err });
        setError(fallbackErrorRef.current);
      }
    };

    start();
    // Re-run only when polling is (re-)enabled or retry() bumps the nonce; the
    // guard above keeps ordinary re-renders from restarting an active poll.
  }, [enabled, startNonce, stopPolling]);

  // Clear any active poll timer on unmount to avoid leaks. Kept separate from
  // the polling effect so ordinary re-renders don't interrupt polling.
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const retry = useCallback(() => {
    stopPolling();
    hasStartedRef.current = false;
    startedAtRef.current = 0;
    setStatus(undefined);
    setResult(undefined);
    setError(undefined);
    setStartNonce((n) => n + 1);
  }, [stopPolling]);

  return { status, result, error, retry };
}
