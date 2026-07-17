/**
 * Tests for POST /api/billing/subscription/pause.
 *
 * Phase 4 / Issue 3 added a 409 guard: a subscription with a pending
 * `stripeScheduleId` (a scheduled plan change) cannot be paused, since a
 * Stripe Subscription Schedule and `pause_collection` would otherwise
 * conflict. The admin must cancel the scheduled change first. This test
 * covers that guard plus the pre-existing pause behavior it now gates.
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
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { POST } from './route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER = { role: 'owner', organizationId: 'org-1' };

const PAUSABLE_SUB = {
  id: 'sub-row-1',
  organizationId: 'org-1',
  stripeSubscriptionId: 'sub_x',
  status: 'active',
  pausedAt: null,
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
  it('pauses the subscription via native pause_collection and restores auditor access to false', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSABLE_SUB);
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST(makeReq({ months: 2 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      pause_collection: { behavior: 'void' },
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { hasAuditorAccess: false },
    });
    expect(body).toEqual(
      expect.objectContaining({ message: 'Subscription has been paused.', success: true }),
    );
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
