/**
 * Tests for POST /api/system/billing/pause-sweep/run.
 *
 * The route exists so the pause sweep can be forced during verification instead
 * of waiting on its quarter-hourly cron. Its whole value is that it (a) refuses
 * anonymous callers, (b) actually runs the sweep and hands back the summary, and
 * (c) starts the worker so the SCHEDULED path keeps firing afterwards — a
 * trigger that ran the sweep but left the cron uninstalled would quietly turn a
 * scheduled sweep into a manual-only one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerify, mockRunJob, mockGetWorker } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockRunJob: vi.fn(),
  mockGetWorker: vi.fn(),
}));

vi.mock('@/lib/system-auth', () => ({ verifySystemAdminCookie: mockVerify }));
vi.mock('@/lib/queue/billing-pause-sweep-worker', () => ({
  runBillingPauseSweepJob: mockRunJob,
  getBillingPauseSweepWorker: mockGetWorker,
}));

import { POST } from './route';

const SUMMARY = {
  scanned: 2,
  materialized: 1,
  skipped: 1,
  wouldMaterialize: 0,
  errors: 0,
};

function makeReq(body?: unknown): Request {
  return {
    json:
      body === undefined
        ? vi.fn().mockRejectedValue(new Error('no body'))
        : vi.fn().mockResolvedValue(body),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockResolvedValue(true);
  mockRunJob.mockResolvedValue(SUMMARY);
});

describe('POST /api/system/billing/pause-sweep/run', () => {
  it('rejects an anonymous caller without running the sweep', async () => {
    mockVerify.mockResolvedValue(false);

    const res = await POST(makeReq({}));

    expect(res.status).toBe(401);
    expect(mockRunJob).not.toHaveBeenCalled();
    expect(mockGetWorker).not.toHaveBeenCalled();
  });

  it('runs the sweep and returns its summary', async () => {
    const res = await POST(makeReq({}));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dryRun: false, summary: SUMMARY });
    expect(mockRunJob).toHaveBeenCalledWith(false);
  });

  it('installs the worker and cron schedule so the scheduled path keeps firing', async () => {
    await POST(makeReq({}));

    expect(mockGetWorker).toHaveBeenCalledOnce();
  });

  it('honours dryRun', async () => {
    await POST(makeReq({ dryRun: true }));

    expect(mockRunJob).toHaveBeenCalledWith(true);
  });

  it('treats a missing or unparseable body as a real (non-dry) run', async () => {
    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(mockRunJob).toHaveBeenCalledWith(false);
  });

  it('returns 500 without leaking the underlying error when the sweep throws', async () => {
    mockRunJob.mockRejectedValue(new Error('stripe exploded'));

    const res = await POST(makeReq({}));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to run billing pause sweep');
  });
});
