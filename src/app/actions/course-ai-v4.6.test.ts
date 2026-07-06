/**
 * Regression tests for THER-002 / THER-013 fixes in course-ai-v4.6.ts:
 *
 *   1. checkCourseGenerationJobV46 NEVER leaks raw internal error detail
 *      (Stage A messages, RAG context, stack traces) to the client — it
 *      always returns the sanitized GENERATION_FAILED_USER_MESSAGE for a
 *      `failed` job.
 *   2. checkCourseGenerationJobV46's stale-job reconciler treats a Job stuck
 *      in `processing` past (timeout + grace) as failed, without disturbing
 *      a Job that is merely mid-flight.
 *   3. processBackgroundV46's wall-clock timeout marks a Job failed when the
 *      pipeline hangs, and the one-shot "settle" guard stops a late pipeline
 *      write (e.g. Stage A finally erroring out) from writing to the Job a
 *      second time after the timeout has already settled it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  prismaMock,
  mockAuth,
  mockCallVertexAI,
  mockAfter,
  mockExtractTextFromFile,
  mockScanText,
  mockCheckRateLimit,
} = vi.hoisted(() => {
  const prismaMock = {
    job: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    courseCategory: { findUnique: vi.fn() },
    document: { findUnique: vi.fn() },
  };
  const mockAuth = vi.fn();
  const mockCallVertexAI = vi.fn();
  const mockAfter = vi.fn((cb: () => Promise<void> | void) => {
    // Mirror next/server's after(): fire-and-forget, not awaited by the caller.
    void cb();
  });
  const mockExtractTextFromFile = vi.fn();
  const mockScanText = vi.fn();
  const mockCheckRateLimit = vi.fn();
  return {
    prismaMock,
    mockAuth,
    mockCallVertexAI,
    mockAfter,
    mockExtractTextFromFile,
    mockScanText,
    mockCheckRateLimit,
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: mockExtractTextFromFile }));
vi.mock('@/lib/rag', () => ({ retrieveRelevantChunks: vi.fn().mockResolvedValue([]) }));
// F-002 / F-018: the foreground PHI gate + rate-limit run before job scheduling.
// Mock them neutrally so the AI mock stays dedicated to the BACKGROUND pipeline
// under test (these unit tests target processBackgroundV46's timeout/settle,
// not the foreground gate).
vi.mock('@/lib/documents/phiScanner', () => ({ scanText: mockScanText }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/ai-client', () => ({
  callVertexAI: mockCallVertexAI,
  truncateToContext: (text: string) => text,
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: mockAfter };
});

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { checkCourseGenerationJobV46, generateCourseAndQuizV46 } from './course-ai-v4.6';

// The sanitized message the fix guarantees — copied from source since it is
// not exported. If this drifts from the real constant, the equality
// assertions below will catch it.
const GENERATION_FAILED_USER_MESSAGE =
  "We couldn't generate a course from this document — it may be too short or lack detail. Please try a more detailed document, or try again.";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const STALE_GRACE_MS = 60 * 1000;

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    status: 'processing',
    payload: null,
    result: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkCourseGenerationJobV46
// ---------------------------------------------------------------------------

describe('checkCourseGenerationJobV46', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.V46_GENERATION_TIMEOUT_MS;
  });

  it('returns "Job not found" when no job exists', async () => {
    prismaMock.job.findUnique.mockResolvedValue(null);

    const result = await checkCourseGenerationJobV46('missing-job');

    expect(result).toEqual({ error: 'Job not found' });
  });

  it('returns the completed result untouched', async () => {
    const resultPayload = { articleMeta: null, articleMarkdown: 'hello' };
    prismaMock.job.findUnique.mockResolvedValue(
      baseJob({ status: 'completed', result: resultPayload }),
    );

    const result = await checkCourseGenerationJobV46('job-1');

    expect(result).toEqual({ status: 'completed', result: resultPayload });
  });

  it('sanitizes a failed job — never leaks raw Stage A / RAG detail to the client', async () => {
    prismaMock.job.findUnique.mockResolvedValue(
      baseJob({
        status: 'failed',
        payload: { error: 'Stage A failed: Insufficient source material — RAG Context empty' },
      }),
    );

    const result = await checkCourseGenerationJobV46('job-1');

    expect(result).toEqual({ status: 'failed', error: GENERATION_FAILED_USER_MESSAGE });
    // Explicitly guard against the exact leak this bug produced.
    expect(result.error).not.toContain('Stage A failed');
    expect(result.error).not.toContain('RAG Context');
  });

  it('sanitizes a failed job even when payload has no error field', async () => {
    prismaMock.job.findUnique.mockResolvedValue(baseJob({ status: 'failed', payload: {} }));

    const result = await checkCourseGenerationJobV46('job-1');

    expect(result).toEqual({ status: 'failed', error: GENERATION_FAILED_USER_MESSAGE });
  });

  it('leaves a processing job that is well within the timeout window alone', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(now);

    const recentlyUpdated = new Date(now.getTime() - 30_000); // 30s ago, timeout is 10min
    prismaMock.job.findUnique.mockResolvedValue(
      baseJob({ status: 'processing', updatedAt: recentlyUpdated }),
    );

    const result = await checkCourseGenerationJobV46('job-1');

    expect(result).toEqual({ status: 'processing' });
    expect(prismaMock.job.updateMany).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('reconciles a job stuck in `processing` past timeout + grace to failed', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(now);

    const staleAfterMs = DEFAULT_TIMEOUT_MS + STALE_GRACE_MS;
    const staleUpdatedAt = new Date(now.getTime() - staleAfterMs - 1_000); // 1s past the grace window
    prismaMock.job.findUnique.mockResolvedValue(
      baseJob({ status: 'processing', updatedAt: staleUpdatedAt }),
    );
    prismaMock.job.updateMany.mockResolvedValue({ count: 1 });

    const result = await checkCourseGenerationJobV46('job-1');

    expect(result).toEqual({ status: 'failed', error: GENERATION_FAILED_USER_MESSAGE });
    // Scoped write: only flips a job that is STILL `processing`, never clobbers
    // a job that settled concurrently.
    expect(prismaMock.job.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: 'processing' },
      data: expect.objectContaining({ status: 'failed' }),
    });

    vi.useRealTimers();
  });

  it('does not reconcile a job exactly at the boundary (age === staleAfterMs)', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(now);

    const staleAfterMs = DEFAULT_TIMEOUT_MS + STALE_GRACE_MS;
    const boundaryUpdatedAt = new Date(now.getTime() - staleAfterMs); // exactly at the edge, not over
    prismaMock.job.findUnique.mockResolvedValue(
      baseJob({ status: 'processing', updatedAt: boundaryUpdatedAt }),
    );

    const result = await checkCourseGenerationJobV46('job-1');

    expect(result).toEqual({ status: 'processing' });
    expect(prismaMock.job.updateMany).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// processBackgroundV46 (exercised indirectly via generateCourseAndQuizV46,
// since it is a module-private function) — wall-clock timeout + settle guard.
// ---------------------------------------------------------------------------

describe('processBackgroundV46 — wall-clock timeout + settle guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.V46_GENERATION_TIMEOUT_MS = '5000'; // short timeout for the test
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockExtractTextFromFile.mockResolvedValue('x'.repeat(200));
    // Foreground gate is neutral: PHI scan passes clean, rate limit allows.
    mockScanText.mockResolvedValue({ hasPHI: false, findings: [] });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetInSeconds: 600 });
    prismaMock.job.create.mockResolvedValue({ id: 'job-timeout-1' });
    prismaMock.job.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.V46_GENERATION_TIMEOUT_MS;
  });

  function buildFormData() {
    const formData = new FormData();
    formData.set('data', JSON.stringify({ title: 'Test Course' }));
    formData.set('file', new File(['source content'], 'source.txt', { type: 'text/plain' }));
    return formData;
  }

  it('marks the Job failed once the wall-clock timeout elapses on a hung pipeline stage', async () => {
    // Stage A's callVertexAI never resolves — simulates a hung Vertex AI call.
    mockCallVertexAI.mockReturnValue(new Promise(() => {}));

    const { jobId } = await generateCourseAndQuizV46(buildFormData());
    expect(jobId).toBe('job-timeout-1');

    // Let the fire-and-forget after() callback reach its first await (Stage A).
    await vi.advanceTimersByTimeAsync(0);

    // Not yet timed out.
    expect(prismaMock.job.update).not.toHaveBeenCalled();

    // Cross the configured timeout.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(prismaMock.job.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.job.update).toHaveBeenCalledWith({
      where: { id: 'job-timeout-1' },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('does not write a second time when the pipeline settles late (after timeout already wrote failed)', async () => {
    let releaseStageA: (value: string) => void = () => {};
    mockCallVertexAI.mockReturnValue(
      new Promise<string>((resolve) => {
        releaseStageA = resolve;
      }),
    );

    await generateCourseAndQuizV46(buildFormData());
    await vi.advanceTimersByTimeAsync(0);

    // Fire the timeout — this is the write that should "win" the race.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(prismaMock.job.update).toHaveBeenCalledTimes(1);

    // Now let Stage A's call resolve with a response that fails validation,
    // driving the pipeline to its own (would-be) failure write.
    releaseStageA('not valid json at all');
    // Stage A retries up to 3 times with 1s/2s/3s backoff between attempts —
    // flush those delays so the pipeline actually reaches its failure branch.
    await vi.advanceTimersByTimeAsync(10_000);

    // The settle() guard must have prevented this late failure from writing
    // to the Job a second time — the timeout's write is final.
    expect(prismaMock.job.update).toHaveBeenCalledTimes(1);
  });
});
