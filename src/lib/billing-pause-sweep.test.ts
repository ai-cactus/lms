/**
 * Unit tests for src/lib/billing-pause-sweep.ts — the sweep that materializes
 * a pending pause (`pauseStartsAt` set, `pausedAt` null) once its boundary
 * arrives.
 *
 * Everything here is driven through an explicit `now` (never a real clock)
 * so the tests are deterministic regardless of when they run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAudit, prismaMock, stripeMock } = vi.hoisted(() => {
  const mockAudit = vi.fn();
  const prismaMock = {
    subscription: { findMany: vi.fn(), update: vi.fn() },
    organization: { update: vi.fn() },
  };
  const stripeMock = {
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
  };
  return { mockAudit, prismaMock, stripeMock };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ getStripeClient: () => stripeMock, default: stripeMock }));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { runBillingPauseSweep, PAUSE_SWEEP_LEAD_MS } from './billing-pause-sweep';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-01T00:00:00Z');

/**
 * The promised boundary. Chosen well BEFORE `NOW` (not just before the
 * cutoff) so that a test asserting `pausedAt === row.pauseStartsAt` cannot
 * pass by coincidentally matching `now` instead — the two must be clearly
 * distinguishable or the assertion proves nothing.
 */
const DUE_PAUSE_STARTS_AT = new Date('2026-08-20T00:00:00Z');

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-row-1',
    organizationId: 'org-1',
    stripeSubscriptionId: 'sub_x',
    pauseStartsAt: DUE_PAUSE_STARTS_AT,
    pauseEndsAt: new Date('2026-11-20T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stripeMock.subscriptions.retrieve.mockResolvedValue({ status: 'active' });
  stripeMock.subscriptions.update.mockResolvedValue({});
  prismaMock.subscription.update.mockResolvedValue({});
  prismaMock.organization.update.mockResolvedValue({});
});

describe('runBillingPauseSweep — cutoff query', () => {
  it('queries only pending pauses at or before the 5-minute-ahead cutoff', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([]);

    await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(prismaMock.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pauseStartsAt: { lte: new Date(NOW.getTime() + PAUSE_SWEEP_LEAD_MS) },
          pausedAt: null,
        },
      }),
    );
  });

  it('a row due within the cutoff is materialized', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([dueRow()]);

    const summary = await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(summary).toEqual({
      scanned: 1,
      materialized: 1,
      skipped: 0,
      wouldMaterialize: 0,
      errors: 0,
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledTimes(1);
  });

  it('a row outside the cutoff is never returned by the query, so it is not touched at all', async () => {
    // The query itself is the guard (pauseStartsAt <= cutoff); simulate Prisma
    // correctly excluding a not-yet-due row by returning an empty result.
    prismaMock.subscription.findMany.mockResolvedValue([]);

    const summary = await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(summary.scanned).toBe(0);
    expect(summary.materialized).toBe(0);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe('runBillingPauseSweep — pausedAt is the PROMISED boundary, not the sweep wall-clock', () => {
  it("writes pausedAt as the row's pauseStartsAt, not `now`", async () => {
    prismaMock.subscription.findMany.mockResolvedValue([dueRow()]);

    await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-row-1' },
      data: { pausedAt: DUE_PAUSE_STARTS_AT, pauseStartsAt: null },
    });
    // The point of the test: now and pauseStartsAt are materially different
    // instants, and the write must use the latter.
    expect(DUE_PAUSE_STARTS_AT.getTime()).not.toBe(NOW.getTime());
    const writtenPausedAt = prismaMock.subscription.update.mock.calls[0][0].data.pausedAt;
    expect(writtenPausedAt).toEqual(DUE_PAUSE_STARTS_AT);
    expect(writtenPausedAt).not.toEqual(NOW);
  });

  it('voids Stripe collection and sets hasAuditorAccess:false on flip', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([dueRow()]);

    await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      pause_collection: { behavior: 'void' },
    });
    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { hasAuditorAccess: false },
    });
  });

  it('audits the materialization', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([dueRow()]);

    await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.pause_materialized',
        organizationId: 'org-1',
        targetId: 'sub-row-1',
        metadata: expect.objectContaining({
          pausedAt: DUE_PAUSE_STARTS_AT.toISOString(),
        }),
      }),
    );
  });
});

describe('runBillingPauseSweep — Stripe no longer considers the subscription pausable', () => {
  it.each(['canceled', 'incomplete_expired', 'unpaid'])(
    'skips with a warning and LEAVES pauseStartsAt in place for status=%s',
    async (status) => {
      prismaMock.subscription.findMany.mockResolvedValue([dueRow()]);
      stripeMock.subscriptions.retrieve.mockResolvedValue({ status });

      const summary = await runBillingPauseSweep({ now: NOW, dryRun: false });

      expect(summary).toEqual({
        scanned: 1,
        materialized: 0,
        skipped: 1,
        wouldMaterialize: 0,
        errors: 0,
      });
      // The org's intent to pause must not be silently discarded — no local
      // write, no Stripe collection change.
      expect(prismaMock.subscription.update).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
      expect(prismaMock.organization.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: expect.stringMatching(/no longer pausable/i),
          organizationId: 'org-1',
        }),
      );
    },
  );

  it.each(['active', 'trialing'])('still materializes for a pausable status=%s', async (status) => {
    prismaMock.subscription.findMany.mockResolvedValue([dueRow()]);
    stripeMock.subscriptions.retrieve.mockResolvedValue({ status });

    const summary = await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(summary.materialized).toBe(1);
    expect(summary.skipped).toBe(0);
  });
});

describe('runBillingPauseSweep — idempotency', () => {
  it('a double run only materializes once (second run finds nothing due)', async () => {
    prismaMock.subscription.findMany.mockResolvedValueOnce([dueRow()]);

    const first = await runBillingPauseSweep({ now: NOW, dryRun: false });
    expect(first.materialized).toBe(1);

    // Second run: the row is now paused (pausedAt set), so the real Prisma
    // query — `pausedAt: null` — would no longer return it. Simulate that.
    prismaMock.subscription.findMany.mockResolvedValueOnce([]);

    const second = await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(second).toEqual({
      scanned: 0,
      materialized: 0,
      skipped: 0,
      wouldMaterialize: 0,
      errors: 0,
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledTimes(1);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledTimes(1);
  });
});

describe('runBillingPauseSweep — dry run', () => {
  it('performs zero writes and reports wouldMaterialize instead of materialized', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([dueRow()]);

    const summary = await runBillingPauseSweep({ now: NOW, dryRun: true });

    expect(summary).toEqual({
      scanned: 1,
      materialized: 0,
      skipped: 0,
      wouldMaterialize: 1,
      errors: 0,
    });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('still calls Stripe retrieve in a dry run (to know if the row is pausable) but no update', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([dueRow()]);

    await runBillingPauseSweep({ now: NOW, dryRun: true });

    expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledWith('sub_x');
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe('runBillingPauseSweep — per-row error isolation', () => {
  it('isolates a failure on one row so the next row is still processed', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      dueRow({ id: 'sub-row-1', organizationId: 'org-1', stripeSubscriptionId: 'sub_bad' }),
      dueRow({ id: 'sub-row-2', organizationId: 'org-2', stripeSubscriptionId: 'sub_good' }),
    ]);
    stripeMock.subscriptions.retrieve.mockImplementation(async (id: string) => {
      if (id === 'sub_bad') throw new Error('Stripe unavailable');
      return { status: 'active' };
    });

    const summary = await runBillingPauseSweep({ now: NOW, dryRun: false });

    expect(summary).toEqual({
      scanned: 2,
      materialized: 1,
      skipped: 0,
      wouldMaterialize: 0,
      errors: 1,
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-row-2' } }),
    );
  });
});
