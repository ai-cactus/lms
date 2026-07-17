import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useJobStatus } from './use-job-status';

// `renderHook` does not itself wrap in `<StrictMode>` unless asked to. RTL's
// `reactStrictMode` option is the reliable way to do that: it wraps the
// rendered element in `<StrictMode>` at the actual root passed to
// `root.render()`, which reproduces the setup -> cleanup -> setup
// double-invocation React performs on mount in development (the mode `next
// dev` runs in). A hand-rolled `wrapper: ({ children }) => <StrictMode>...`
// does NOT reliably reproduce this in this React/RTL version — nesting
// `<StrictMode>` one function-component layer below the render root does not
// trigger the double-invoke pass, verified empirically before writing these
// tests.
const strictModeOptions = { reactStrictMode: true } as const;

describe('useJobStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('surfaces a completed result and stops polling on a terminal state', async () => {
    const poll = vi.fn().mockResolvedValue({ status: 'completed', result: { id: 42 } });
    const onCompleted = vi.fn();

    const { result } = renderHook(() =>
      useJobStatus<{ id: number }>({
        poll,
        onCompleted,
        intervalMs: 1000,
        fallbackError: 'FALLBACK',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(onCompleted).toHaveBeenCalledExactlyOnceWith({ id: 42 });
    expect(result.current.status).toBe('completed');
    expect(result.current.result).toEqual({ id: 42 });
    expect(result.current.error).toBeUndefined();

    // A terminal state must stop the interval — no further polling.
    poll.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(poll).not.toHaveBeenCalled();
  });

  test('keeps polling while processing, then surfaces the poll-cap timeout', async () => {
    const poll = vi.fn().mockResolvedValue({ status: 'processing' });

    const { result } = renderHook(() =>
      useJobStatus({ poll, intervalMs: 1000, maxPollMs: 3000, fallbackError: 'FALLBACK' }),
    );

    // Ticks at 1s/2s/3s stay in flight (3000 is not strictly greater than the cap).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.status).toBe('processing');

    // The 4s tick exceeds the cap — surface the caller's fallback message and stop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.error).toBe('FALLBACK');

    poll.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(poll).not.toHaveBeenCalled();
  });

  test('a failed status wins over the fallback and uses the returned error', async () => {
    const poll = vi.fn().mockResolvedValue({ status: 'failed', error: 'safe message' });

    const { result } = renderHook(() =>
      useJobStatus({ poll, intervalMs: 1000, fallbackError: 'FALLBACK' }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe('safe message');
  });

  test('a failed status without an error falls back to the caller message', async () => {
    const poll = vi.fn().mockResolvedValue({ status: 'failed' });

    const { result } = renderHook(() =>
      useJobStatus({ poll, intervalMs: 1000, fallbackError: 'FALLBACK' }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.error).toBe('FALLBACK');
  });

  test('a non-terminal check error surfaces the safe fallback and stops', async () => {
    const poll = vi.fn().mockResolvedValue({ error: 'Job not found' });

    const { result } = renderHook(() =>
      useJobStatus({ poll, intervalMs: 1000, fallbackError: 'FALLBACK' }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // The raw error is replaced by the safe fallback, never leaked verbatim.
    expect(result.current.error).toBe('FALLBACK');

    poll.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(poll).not.toHaveBeenCalled();
  });

  test('a createJob failure surfaces its error and never polls', async () => {
    const createJob = vi.fn().mockResolvedValue({ error: 'Failed to start generation job' });
    const poll = vi.fn().mockResolvedValue({ status: 'processing' });

    const { result } = renderHook(() =>
      useJobStatus({ createJob, poll, intervalMs: 1000, fallbackError: 'FALLBACK' }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(createJob).toHaveBeenCalledOnce();
    expect(result.current.error).toBe('Failed to start generation job');
    expect(poll).not.toHaveBeenCalled();
  });

  test('retry clears the error and re-runs createJob + polling', async () => {
    const createJob = vi.fn().mockResolvedValue(undefined);
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed', error: 'boom' })
      .mockResolvedValue({ status: 'processing' });

    const { result } = renderHook(() =>
      useJobStatus({ createJob, poll, intervalMs: 1000, fallbackError: 'FALLBACK' }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.error).toBe('boom');
    expect(createJob).toHaveBeenCalledOnce();

    act(() => {
      result.current.retry();
    });

    // Error is cleared synchronously so the UI can re-enter its loading state.
    expect(result.current.error).toBeUndefined();
    expect(result.current.status).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // createJob ran again and polling resumed.
    expect(createJob).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('processing');
    expect(result.current.error).toBeUndefined();
  });

  describe('under React StrictMode', () => {
    // Regression coverage for a dev-only bug: the single-start guard
    // (`hasStartedRef`) and the interval teardown used to live in separate
    // effects. StrictMode mounts by running setup -> cleanup -> setup; the
    // cleanup cleared the interval but left `hasStartedRef` latched `true`,
    // so the re-setup's guard check (`if (hasStartedRef.current) return;`)
    // early-returned and the interval was never rearmed — polling silently
    // never started in dev. The fix moved teardown into the polling effect
    // and reset `hasStartedRef.current = false` there, so the StrictMode
    // remount rearms it. Plain `renderHook` (used by every test above) does
    // NOT double-invoke effects and so could never have caught this.

    test('polling survives the StrictMode mount/cleanup/remount cycle and detects a completed job', async () => {
      const poll = vi.fn().mockResolvedValue({ status: 'completed', result: { id: 42 } });
      const onCompleted = vi.fn();

      const { result } = renderHook(
        () =>
          useJobStatus<{ id: number }>({
            poll,
            onCompleted,
            intervalMs: 1000,
            fallbackError: 'FALLBACK',
          }),
        strictModeOptions,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // Against the pre-fix hook, the StrictMode remount would leave
      // `hasStartedRef` latched from the cleanup pass, the interval would
      // never be rearmed, `poll` would never be called, and `status`/`result`
      // would stay `undefined` forever — this assertion set fails on that
      // version and passes only because the guard reset lets the remounted
      // effect start a fresh interval.
      expect(poll).toHaveBeenCalled();
      expect(onCompleted).toHaveBeenCalledExactlyOnceWith({ id: 42 });
      expect(result.current.status).toBe('completed');
      expect(result.current.result).toEqual({ id: 42 });
      expect(result.current.error).toBeUndefined();
    });

    test('the StrictMode remount starts exactly one interval, not a duplicate poll storm', async () => {
      const poll = vi.fn().mockResolvedValue({ status: 'processing' });

      renderHook(
        () => useJobStatus({ poll, intervalMs: 1000, fallbackError: 'FALLBACK' }),
        strictModeOptions,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // One armed interval calls `poll` once per elapsed tick. If the guard
      // reset caused the effect to *also* leave the original interval running
      // (rather than cleanly replacing it), two intervals would each fire on
      // this tick and `poll` would be called twice.
      expect(poll).toHaveBeenCalledTimes(1);

      poll.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(poll).toHaveBeenCalledTimes(1);
    });
  });
});
