/**
 * Tests for POST /api/billing/subscription/cancel.
 *
 * Phase 4 / Issue 3 added a 409 guard: a subscription with a pending
 * `stripeScheduleId` (a scheduled plan change) cannot be canceled, since a
 * Stripe Subscription Schedule and `cancel_at_period_end` would otherwise
 * conflict. The admin must cancel the scheduled change first.
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
  };
  return { mockAuth, mockAudit, prismaMock, stripeMock };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ getStripeClient: () => stripeMock, default: stripeMock }));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
});

describe('POST /api/billing/subscription/cancel — scheduled-change guard', () => {
  it('returns 409 and does not touch Stripe when a plan change is pending', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...CANCELABLE_SUB,
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
