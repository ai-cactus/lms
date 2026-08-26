/**
 * Tests for POST /api/billing/subscription/cancel.
 *
 * A subscription with a pending `stripeScheduleId` used to be hard-blocked
 * with a 409, because Stripe rejects `cancel_at_period_end` updates while a
 * Subscription Schedule wraps the subscription. That guard also fired on a
 * stale local mirror, leaving admins unable to cancel at all. The route now
 * releases the pending schedule first and proceeds; only a release that fails
 * upstream stops the cancellation, with a 502.
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
  };
  const stripeMock = {
    subscriptions: { update: vi.fn() },
    subscriptionSchedules: { retrieve: vi.fn(), release: vi.fn() },
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

const CANCELABLE_SUB = {
  id: 'sub-row-1',
  organizationId: 'org-1',
  stripeSubscriptionId: 'sub_x',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date('2026-08-17T00:00:00Z'),
  stripeScheduleId: null,
  scheduledEffectiveAt: null,
};

function makeReq(body: unknown = {}): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

const SCHEDULED_SUB = {
  ...CANCELABLE_SUB,
  stripeScheduleId: 'sub_sched_1',
  scheduledEffectiveAt: new Date('2026-08-17T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: 'org-1' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
  stripeMock.subscriptionSchedules.retrieve.mockResolvedValue({
    id: 'sub_sched_1',
    status: 'active',
  });
  stripeMock.subscriptionSchedules.release.mockResolvedValue({});
});

describe('POST /api/billing/subscription/cancel — pending plan-change schedule', () => {
  it('releases the pending schedule and then cancels at period end', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(SCHEDULED_SUB);
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched_1');
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      cancel_at_period_end: true,
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: {
        scheduledPlan: null,
        scheduledBillingCycle: null,
        scheduledPriceId: null,
        scheduledEffectiveAt: null,
        stripeScheduleId: null,
      },
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.cancel',
        metadata: { cancelAtPeriodEnd: true, releasedSchedule: true },
      }),
    );
  });

  it('returns 502 and never cancels when the release fails upstream', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(SCHEDULED_SUB);
    stripeMock.subscriptionSchedules.release.mockRejectedValue(new Error('Stripe API error'));

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toMatch(/unable to update your subscription/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/subscription/cancel — normal path (no pending schedule)', () => {
  it('schedules cancellation at period end via cancel_at_period_end', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(CANCELABLE_SUB);
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST(makeReq({ reason: 'too expensive' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      cancel_at_period_end: true,
      cancellation_details: { comment: 'too expensive' },
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: { cancelAtPeriodEnd: true },
    });
    expect(body).toEqual(
      expect.objectContaining({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: CANCELABLE_SUB.currentPeriodEnd.toISOString(),
      }),
    );
  });

  it('returns 409 when cancellation is already scheduled', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...CANCELABLE_SUB,
      cancelAtPeriodEnd: true,
    });

    const res = await POST(makeReq());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already scheduled for cancellation/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
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
describe('POST /api/billing/subscription/cancel — RBAC (billing.edit registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never touches Stripe or the subscription row',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await POST(makeReq());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    },
  );

  it('allows role=finance through to the normal cancel path', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'finance', organizationId: 'org-1' },
    });
    prismaMock.subscription.findUnique.mockResolvedValue(CANCELABLE_SUB);
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST(makeReq({ reason: 'too expensive' }));

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalled();
  });
});
