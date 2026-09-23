/**
 * Unit tests for cycle-summary-worker.ts.
 *
 * The worker shell is the half of the cutover that decides whether the unified
 * summary is delivered at all, so these cover:
 *   - the flag gate: the worker starts only on CYCLE_SUMMARY_ENABLED='true', and
 *     the notification-digest worker it replaces stands down on the same value
 *     (they claim the same period row, so both running would mean a partial send)
 *   - the singleton: a second call returns the same instance
 *   - the cron Job Scheduler: registered idempotently, overridable, and after the
 *     reminder sweep by default
 *   - run order: retry BEFORE compose — the retry's rows are already stamped
 *     `summarizedAt`, so a compose-first pass would never give them a second
 *     chance
 *   - dry-run resolution from CYCLE_SUMMARY_DRY_RUN, and the per-job override
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  MockWorker,
  workerCalls,
  mockRunCycleSummary,
  mockRunCycleSummaryRetry,
  mockCycleSummaryQueue,
  mockLoggerInfo,
} = vi.hoisted(() => {
  const mockCycleSummaryQueue = {
    getJobSchedulers: vi.fn().mockResolvedValue([]),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
  };

  // Worker constructor must be a regular function to support `new`. Its
  // arguments are recorded here because vi.fn's own `mock.calls` tuple is typed
  // from the (this-only) signature, which makes them unreachable.
  const workerCalls: {
    name: string;
    processor: (job: { data?: { dryRun?: boolean } }) => Promise<void>;
    opts: Record<string, unknown>;
  }[] = [];

  const MockWorker = vi.fn(function (
    this: Record<string, unknown>,
    name: string,
    processor: (job: { data?: { dryRun?: boolean } }) => Promise<void>,
    opts: Record<string, unknown>,
  ) {
    this.on = vi.fn();
    workerCalls.push({ name, processor, opts });
  });

  return {
    MockWorker,
    workerCalls,
    mockRunCycleSummary: vi.fn(),
    mockRunCycleSummaryRetry: vi.fn(),
    mockCycleSummaryQueue,
    mockLoggerInfo: vi.fn(),
  };
});

vi.mock('bullmq', () => ({ Worker: MockWorker }));
vi.mock('@/lib/queue/redis', () => ({ redis: {} }));
vi.mock('@/lib/queue/cycle-summary-queue', () => ({
  CYCLE_SUMMARY_QUEUE_NAME: 'cycle-summary-queue',
  cycleSummaryQueue: mockCycleSummaryQueue,
}));
vi.mock('@/lib/cycle-summary/compose', () => ({ runCycleSummary: mockRunCycleSummary }));
vi.mock('@/lib/cycle-summary/retry', () => ({ runCycleSummaryRetry: mockRunCycleSummaryRetry }));
vi.mock('@/lib/cycle-summary/email-sender', () => ({ cycleSummaryEmailSender: vi.fn() }));
vi.mock('@/lib/notifications/digest', () => ({ runNotificationDigest: vi.fn() }));
vi.mock('@/lib/notifications/email-sender', () => ({ notificationDigestSender: vi.fn() }));
vi.mock('@/lib/queue/notification-digest-queue', () => ({
  NOTIFICATION_DIGEST_QUEUE_NAME: 'notification-digest-queue',
  notificationDigestQueue: {
    getJobSchedulers: vi.fn().mockResolvedValue([]),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: mockLoggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import type { Worker } from 'bullmq';
import { getCycleSummaryWorker, runCycleSummaryJob } from './cycle-summary-worker';
import { getNotificationDigestWorker } from './notification-digest-worker';

/** Both workers are globalThis singletons; a stale one would mask every gate. */
function clearWorkerSingletons(): void {
  const g = globalThis as unknown as {
    __cycleSummaryWorker?: Worker;
    __notificationDigestWorker?: Worker;
  };
  delete g.__cycleSummaryWorker;
  delete g.__notificationDigestWorker;
}

beforeEach(() => {
  vi.clearAllMocks();
  workerCalls.length = 0;
  clearWorkerSingletons();
  mockRunCycleSummary.mockResolvedValue({ organizationsScanned: 0, emailsSent: 0 });
  mockRunCycleSummaryRetry.mockResolvedValue({ candidates: 0, resent: 0 });
  mockCycleSummaryQueue.getJobSchedulers.mockResolvedValue([]);
});

afterEach(() => {
  clearWorkerSingletons();
  delete process.env.CYCLE_SUMMARY_ENABLED;
  delete process.env.CYCLE_SUMMARY_CRON;
  delete process.env.CYCLE_SUMMARY_DRY_RUN;
  delete process.env.NOTIFICATION_DIGEST_ENABLED;
});

describe('getCycleSummaryWorker — the cutover gate', () => {
  it('starts nothing while the flag is unset', () => {
    expect(getCycleSummaryWorker()).toBeNull();
    expect(MockWorker).not.toHaveBeenCalled();
    expect(mockCycleSummaryQueue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('treats any value other than "true" as off — the flag is opt-in', () => {
    process.env.CYCLE_SUMMARY_ENABLED = '1';

    expect(getCycleSummaryWorker()).toBeNull();
    expect(MockWorker).not.toHaveBeenCalled();
  });

  it('starts the worker on CYCLE_SUMMARY_ENABLED="true"', async () => {
    process.env.CYCLE_SUMMARY_ENABLED = 'true';

    const worker = getCycleSummaryWorker();

    expect(worker).not.toBeNull();
    expect(MockWorker).toHaveBeenCalledOnce();
    expect(workerCalls[0].opts).toMatchObject({ concurrency: 1 });
    // registerRepeatableJob is fire-and-forget — flush its microtasks first.
    await vi.waitFor(() => expect(mockCycleSummaryQueue.upsertJobScheduler).toHaveBeenCalled());
  });

  it('returns the same instance on a second call', () => {
    process.env.CYCLE_SUMMARY_ENABLED = 'true';

    const first = getCycleSummaryWorker();
    const second = getCycleSummaryWorker();

    expect(first).toBe(second);
    expect(MockWorker).toHaveBeenCalledOnce();
  });

  it('stands the notification digest down on the same flag', () => {
    process.env.CYCLE_SUMMARY_ENABLED = 'true';
    // The digest's own flag says "run"; the cutover still wins, because both
    // claim the same CycleSummaryRun (organizationId, periodKey) row.
    process.env.NOTIFICATION_DIGEST_ENABLED = 'true';

    expect(getNotificationDigestWorker()).toBeNull();
    expect(MockWorker).not.toHaveBeenCalled();
  });

  it('leaves the notification digest running while the flag is off', () => {
    expect(getNotificationDigestWorker()).not.toBeNull();
    expect(MockWorker).toHaveBeenCalledOnce();
  });
});

describe('getCycleSummaryWorker — cron schedule', () => {
  beforeEach(() => {
    process.env.CYCLE_SUMMARY_ENABLED = 'true';
  });

  it('registers the daily 13:00 UTC schedule, after the 08:00 reminder sweep', async () => {
    getCycleSummaryWorker();

    await vi.waitFor(() =>
      expect(mockCycleSummaryQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'cycle-summary',
        { pattern: '0 13 * * *' },
        { name: 'summary' },
      ),
    );
  });

  it('honours CYCLE_SUMMARY_CRON', async () => {
    process.env.CYCLE_SUMMARY_CRON = '30 14 * * *';

    getCycleSummaryWorker();

    await vi.waitFor(() =>
      expect(mockCycleSummaryQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'cycle-summary',
        { pattern: '30 14 * * *' },
        expect.anything(),
      ),
    );
  });

  it('removes a stale schedule under the same id before upserting', async () => {
    mockCycleSummaryQueue.getJobSchedulers.mockResolvedValue([{ id: 'cycle-summary' }]);

    getCycleSummaryWorker();

    await vi.waitFor(() =>
      expect(mockCycleSummaryQueue.removeJobScheduler).toHaveBeenCalledWith('cycle-summary'),
    );
  });
});

describe('runCycleSummaryJob', () => {
  it('runs the retry pass BEFORE composing the day', async () => {
    const order: string[] = [];
    mockRunCycleSummaryRetry.mockImplementation(async () => {
      order.push('retry');
      return {};
    });
    mockRunCycleSummary.mockImplementation(async () => {
      order.push('compose');
      return {};
    });

    await runCycleSummaryJob(false);

    // A failed summary's rows are already stamped `summarizedAt`, so composing
    // first would close the window this retry exists to reopen.
    expect(order).toEqual(['retry', 'compose']);
  });

  it('passes dryRun through to both passes', async () => {
    await runCycleSummaryJob(true);

    expect(mockRunCycleSummaryRetry).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
    expect(mockRunCycleSummary).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('injects the real email sender into both passes', async () => {
    await runCycleSummaryJob(false);

    expect(mockRunCycleSummary).toHaveBeenCalledWith(
      expect.objectContaining({ sendEmail: expect.any(Function) }),
    );
    expect(mockRunCycleSummaryRetry).toHaveBeenCalledWith(
      expect.objectContaining({ sendEmail: expect.any(Function) }),
    );
  });

  it('returns both pass summaries', async () => {
    mockRunCycleSummaryRetry.mockResolvedValue({ candidates: 2, resent: 1 });
    mockRunCycleSummary.mockResolvedValue({ organizationsScanned: 3, emailsSent: 7 });

    const summary = await runCycleSummaryJob(false);

    expect(summary).toEqual({
      retry: { candidates: 2, resent: 1 },
      compose: { organizationsScanned: 3, emailsSent: 7 },
    });
  });
});

describe('dry-run resolution', () => {
  beforeEach(() => {
    process.env.CYCLE_SUMMARY_ENABLED = 'true';
  });

  it('defaults to a live run when CYCLE_SUMMARY_DRY_RUN is unset', async () => {
    getCycleSummaryWorker();

    await workerCalls[0].processor({ data: {} });

    expect(mockRunCycleSummary).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it('runs dry when CYCLE_SUMMARY_DRY_RUN="true"', async () => {
    process.env.CYCLE_SUMMARY_DRY_RUN = 'true';
    getCycleSummaryWorker();

    await workerCalls[0].processor({ data: {} });

    expect(mockRunCycleSummary).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('lets a single job override the env default', async () => {
    getCycleSummaryWorker();

    await workerCalls[0].processor({ data: { dryRun: true } });

    expect(mockRunCycleSummary).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });
});
