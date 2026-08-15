import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useMultiJobStatus } from './use-multi-job-status';

/**
 * The multi-module generation screen reduces N jobs to one staged checklist, so
 * these tests pin the aggregate phases (created → started → completed), the
 * scoped retry that re-runs a single failed module without disturbing the ones
 * that already succeeded, and the poll-cap backstop.
 */
describe('useMultiJobStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('creates one job per module and advances the aggregate phases', async () => {
    const createJobs = vi.fn(async (moduleIndexes: number[]) =>
      moduleIndexes.map((moduleIndex) => ({ moduleIndex, jobId: `job-${moduleIndex}` })),
    );
    const poll = vi.fn().mockResolvedValue({ status: 'processing' });
    const onAllCompleted = vi.fn();
    const onJobsCreated = vi.fn();

    const { result } = renderHook(() =>
      useMultiJobStatus<{ id: string }>({
        moduleIndexes: [0, 1],
        createJobs,
        poll,
        onAllCompleted,
        onJobsCreated,
        intervalMs: 1000,
        fallbackError: 'FALLBACK',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(createJobs).toHaveBeenCalledExactlyOnceWith([0, 1]);
    expect(onJobsCreated).toHaveBeenCalledWith([
      { moduleIndex: 0, jobId: 'job-0' },
      { moduleIndex: 1, jobId: 'job-1' },
    ]);
    expect(result.current.progress).toEqual({
      jobsCreated: true,
      allStarted: true,
      allCompleted: false,
    });

    poll.mockResolvedValue({ status: 'completed', result: { id: 'done' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.progress.allCompleted).toBe(true);
    expect(onAllCompleted).toHaveBeenCalledExactlyOnceWith([
      { moduleIndex: 0, result: { id: 'done' } },
      { moduleIndex: 1, result: { id: 'done' } },
    ]);

    // A terminal run must stop the interval.
    poll.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(poll).not.toHaveBeenCalled();
  });

  test('retries only the failed module and keeps the completed one', async () => {
    const createJobs = vi.fn(async (moduleIndexes: number[]) =>
      moduleIndexes.map((moduleIndex) => ({ moduleIndex, jobId: `job-${moduleIndex}` })),
    );
    const poll = vi.fn(async (jobId: string) =>
      jobId === 'job-0'
        ? { status: 'completed' as const, result: { id: 'first' } }
        : { status: 'failed' as const, error: 'module blew up' },
    );
    const onAllCompleted = vi.fn();

    const { result } = renderHook(() =>
      useMultiJobStatus<{ id: string }>({
        moduleIndexes: [0, 1],
        createJobs,
        poll,
        onAllCompleted,
        intervalMs: 1000,
        fallbackError: 'FALLBACK',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.failedModules).toHaveLength(1);
    expect(result.current.failedModules[0]).toMatchObject({
      moduleIndex: 1,
      error: 'module blew up',
    });
    expect(onAllCompleted).not.toHaveBeenCalled();

    createJobs.mockClear();
    poll.mockImplementation(async () => ({
      status: 'completed' as const,
      result: { id: 'retry' },
    }));

    await act(async () => {
      result.current.retryModule(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Only the failed module is recreated — the completed one is left alone.
    expect(createJobs).toHaveBeenCalledExactlyOnceWith([1]);
    expect(result.current.failedModules).toHaveLength(0);
    expect(onAllCompleted).toHaveBeenCalledExactlyOnceWith([
      { moduleIndex: 0, result: { id: 'first' } },
      { moduleIndex: 1, result: { id: 'retry' } },
    ]);
  });

  test('does not start a second job per module under StrictMode double-mount', async () => {
    // Creation is deliberately slow so the second start pass runs while the
    // first is still in flight — the case that used to double every job.
    const createJobs = vi.fn(
      (moduleIndexes: number[]) =>
        new Promise<{ moduleIndex: number; jobId: string }[]>((resolve) => {
          setTimeout(
            () =>
              resolve(
                moduleIndexes.map((moduleIndex) => ({ moduleIndex, jobId: `job-${moduleIndex}` })),
              ),
            50,
          );
        }),
    );
    const poll = vi.fn().mockResolvedValue({ status: 'processing' });

    const { result } = renderHook(
      () =>
        useMultiJobStatus({
          moduleIndexes: [0, 1],
          createJobs,
          poll,
          intervalMs: 1000,
          fallbackError: 'FALLBACK',
        }),
      { reactStrictMode: true },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(createJobs).toHaveBeenCalledExactlyOnceWith([0, 1]);
    expect(result.current.progress.jobsCreated).toBe(true);
  });

  test('resumes supplied jobs instead of creating a second set', async () => {
    const createJobs = vi.fn(async () => []);
    const poll = vi.fn().mockResolvedValue({ status: 'processing' });

    const { result } = renderHook(() =>
      useMultiJobStatus({
        moduleIndexes: [0, 1],
        initialJobs: [
          { moduleIndex: 0, jobId: 'resumed-0' },
          { moduleIndex: 1, jobId: 'resumed-1' },
        ],
        createJobs,
        poll,
        intervalMs: 1000,
        fallbackError: 'FALLBACK',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(createJobs).not.toHaveBeenCalled();
    expect(poll.mock.calls.map(([jobId]) => jobId)).toEqual(['resumed-0', 'resumed-1']);
    expect(result.current.progress.jobsCreated).toBe(true);
  });

  test('surfaces a module that could not be started', async () => {
    const createJobs = vi.fn(async () => [
      { moduleIndex: 0, jobId: 'job-0' },
      { moduleIndex: 1, error: 'no document' },
    ]);
    const poll = vi.fn().mockResolvedValue({ status: 'processing' });

    const { result } = renderHook(() =>
      useMultiJobStatus({
        moduleIndexes: [0, 1],
        createJobs,
        poll,
        intervalMs: 1000,
        fallbackError: 'FALLBACK',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.progress.jobsCreated).toBe(false);
    expect(result.current.failedModules).toHaveLength(1);
    expect(result.current.failedModules[0].error).toBe('no document');
  });

  test('fails the still-running modules once the poll cap is exceeded', async () => {
    const createJobs = vi.fn(async (moduleIndexes: number[]) =>
      moduleIndexes.map((moduleIndex) => ({ moduleIndex, jobId: `job-${moduleIndex}` })),
    );
    const poll = vi.fn().mockResolvedValue({ status: 'processing' });

    const { result } = renderHook(() =>
      useMultiJobStatus({
        moduleIndexes: [0, 1],
        createJobs,
        poll,
        intervalMs: 1000,
        maxPollMs: 3000,
        fallbackError: 'FALLBACK',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.failedModules).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.failedModules).toHaveLength(2);
    expect(result.current.failedModules.every((job) => job.error === 'FALLBACK')).toBe(true);
  });
});
