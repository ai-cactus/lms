/**
 * Tests for POST /api/billing/subscription/pause.
 *
 * Phase 4 / Issue 3 added a 409 guard: a subscription with a pending
 * `stripeScheduleId` (a scheduled plan change) cannot be paused, since a
 * Stripe Subscription Schedule and `pause_collection` would otherwise
 * conflict. The admin must cancel the scheduled change first.
 *
 * Product decision 2026-08-27 made the pause DEFERRED: the route now records
 * intent only (`pauseStartsAt` = currentPeriodEnd, `pauseEndsAt` measured from
 * that boundary) and makes NO Stripe call. `pausedAt`, `hasAuditorAccess` and
 * therefore every access gate stay untouched until the sweep materializes the
 * pause. These tests cover that, the three 409 guards, and the RBAC gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAuth, mockAudit, prismaMock, stripeMock } = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const mockAudit = vi.fn();
  const prismaMock = {
    user: { findUnique: vi.fn() },
    subscription: { findUnique: vi.fn(), update: vi.fn() },
    organization: { update: vi.fn() },
  };
  const stripeMock = {
    subscriptions: { update: vi.fn() },
  };
  return { mockAuth, mockAudit, prismaMock, stripeMock };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
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
import { POST } from './route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER = { role: 'owner', organizationId: 'org-1' };

const PERIOD_END = new Date('2026-09-01T00:00:00Z');

const PAUSABLE_SUB = {
  id: 'sub-row-1',
  organizationId: 'org-1',
  stripeSubscriptionId: 'sub_x',
  status: 'active',
  currentPeriodEnd: PERIOD_END,
  pauseStartsAt: null,
  pausedAt: null,
  stripeScheduleId: null,
  scheduledEffectiveAt: null,
};

function makeReq(body: unknown = {}): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: 'org-1' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
});

describe('POST /api/billing/subscription/pause — scheduled-change guard', () => {
  it('returns 409 and does not touch Stripe when a plan change is pending', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...PAUSABLE_SUB,
      stripeScheduleId: 'sub_sched_1',
      scheduledEffectiveAt: new Date('2026-08-17T00:00:00Z'),
    });

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/pending plan change/i);
    expect(body.error).toMatch(/cancel it first/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  it('falls back to generic wording when scheduledEffectiveAt is unexpectedly absent', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...PAUSABLE_SUB,
      stripeScheduleId: 'sub_sched_1',
      scheduledEffectiveAt: null,
    });

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/end of your billing period/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/subscription/pause — normal path (no pending schedule)', () => {
  it('records a pending pause at period end without calling Stripe or withdrawing access', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSABLE_SUB);

    const res = await POST(makeReq({ months: 2 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    // No Stripe call: pause_collection takes effect immediately, which would
    // stop collection mid-period. The sweep applies it at the boundary.
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      // pauseEndsAt is measured from the pause's real START, not from now, so
      // the admin gets the full window they asked for.
      data: { pauseStartsAt: PERIOD_END, pauseEndsAt: new Date('2026-11-01T00:00:00Z') },
    });
    // pausedAt is untouched, so hasActiveBilling() still reports active — the
    // org keeps full access for the period it already paid for.
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
    expect(body).toEqual(
      expect.objectContaining({
        message: 'Your subscription will pause at the end of your current billing period.',
        success: true,
      }),
    );
  });

  it("audits the pause with mode 'pending'", async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSABLE_SUB);

    await POST(makeReq({ months: 1 }));

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.pause',
        targetId: 'sub-row-1',
        metadata: expect.objectContaining({ months: 1, mode: 'pending' }),
      }),
    );
  });

  it('returns 409 when a pause is already pending', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...PAUSABLE_SUB,
      pauseStartsAt: PERIOD_END,
    });

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already scheduled to pause/i);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  it('returns 409 when the subscription is already paused', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...PAUSABLE_SUB,
      pausedAt: new Date('2026-06-01T00:00:00Z'),
    });

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already paused/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns 400 for an out-of-range pause duration', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSABLE_SUB);

    const res = await POST(makeReq({ months: 12 }));

    expect(res.status).toBe(400);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the org has no subscription row', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq());

    expect(res.status).toBe(404);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq());

    expect(res.status).toBe(401);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RBAC: billing.* is reserved for owner + finance. Regression guard for the
// isAdminRole → authorize('billing.edit') migration.
// ---------------------------------------------------------------------------
describe('POST /api/billing/subscription/pause — RBAC (billing.edit registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never touches Stripe or the subscription row',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await POST(makeReq({ months: 2 }));
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    },
  );

  it('allows role=finance through to the normal pause path', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'finance', organizationId: 'org-1' },
    });
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSABLE_SUB);

    const res = await POST(makeReq({ months: 2 }));

    expect(res.status).toBe(200);
    expect(prismaMock.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
  });
});
