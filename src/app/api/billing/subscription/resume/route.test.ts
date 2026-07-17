/**
 * Tests for POST /api/billing/subscription/resume.
 *
 * Phase 4 / Issue 3 added a 409 guard: a paused subscription with a pending
 * `stripeScheduleId` (a scheduled plan change) cannot be resumed via this
 * route, since clearing `pause_collection` while a Schedule is active would
 * conflict with the Schedule API. The admin must cancel the scheduled change
 * first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
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

const PAUSED_SUB = {
  id: 'sub-row-1',
  organizationId: 'org-1',
  stripeSubscriptionId: 'sub_x',
  status: 'active',
  pausedAt: new Date('2026-06-01T00:00:00Z'),
  stripeScheduleId: null,
  scheduledEffectiveAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
});

describe('POST /api/billing/subscription/resume — scheduled-change guard', () => {
  it('returns 409 and does not touch Stripe when a plan change is pending', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...PAUSED_SUB,
      stripeScheduleId: 'sub_sched_1',
      scheduledEffectiveAt: new Date('2026-08-17T00:00:00Z'),
    });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/pending plan change/i);
    expect(body.error).toMatch(/cancel it first/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/subscription/resume — normal path (no pending schedule)', () => {
  it('clears the pause window and restores auditor access', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSED_SUB);
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      pause_collection: null,
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: { pausedAt: null, pauseEndsAt: null },
    });
    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { hasAuditorAccess: true },
    });
    expect(body).toEqual({ message: 'Subscription has been resumed.', success: true });
  });

  it('returns 409 when the subscription is not actually paused', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ ...PAUSED_SUB, pausedAt: null });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/not paused/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the org has no subscription row', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(404);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });
});
