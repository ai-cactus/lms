/**
 * Tests for POST /api/billing/subscription/resume.
 *
 * A paused subscription with a pending `stripeScheduleId` used to be
 * hard-blocked with a 409, since clearing `pause_collection` while a Schedule
 * wraps the subscription conflicts with the Schedule API. Because checkout
 * lets a paused org schedule a plan change, that guard trapped orgs in the
 * paused state with no way back. The route now releases the pending schedule
 * first and proceeds; only a release that fails upstream stops it, with a 502.
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
    subscriptionSchedules: { retrieve: vi.fn(), release: vi.fn() },
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

const PAUSED_SUB = {
  id: 'sub-row-1',
  organizationId: 'org-1',
  stripeSubscriptionId: 'sub_x',
  status: 'active',
  pausedAt: new Date('2026-06-01T00:00:00Z'),
  stripeScheduleId: null,
  scheduledEffectiveAt: null,
};

const PAUSED_SUB_WITH_SCHEDULE = {
  ...PAUSED_SUB,
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

describe('POST /api/billing/subscription/resume — pending plan-change schedule', () => {
  it('releases the pending schedule and then resumes the subscription', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSED_SUB_WITH_SCHEDULE);
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched_1');
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      pause_collection: null,
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
        action: 'billing.subscription.resume',
        metadata: { releasedSchedule: true },
      }),
    );
  });

  it('resumes without a release call when Stripe no longer has the schedule', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSED_SUB_WITH_SCHEDULE);
    stripeMock.subscriptionSchedules.retrieve.mockRejectedValue(
      Object.assign(new Error('No such subscription schedule'), { code: 'resource_missing' }),
    );
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      pause_collection: null,
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { releasedSchedule: false } }),
    );
  });

  it('returns 502 and never resumes when the release fails upstream', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSED_SUB_WITH_SCHEDULE);
    stripeMock.subscriptionSchedules.release.mockRejectedValue(new Error('Stripe API error'));

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toMatch(/unable to update your subscription/i);
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

// ---------------------------------------------------------------------------
// RBAC: billing.* is reserved for owner + finance in the permission registry.
// Regression guard for the isAdminRole → authorize('billing.edit') migration —
// Supervisor/HR/Clinical Director previously passed isAdminRole and could
// reach this route; they must now 403 with no Stripe data touched.
// ---------------------------------------------------------------------------
describe('POST /api/billing/subscription/resume — RBAC (billing.edit registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never touches Stripe or the subscription row',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    },
  );

  it('allows role=finance through to the normal resume path', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'finance', organizationId: 'org-1' },
    });
    prismaMock.subscription.findUnique.mockResolvedValue(PAUSED_SUB);
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      pause_collection: null,
    });
  });

  it('still enforces the MFA step-up guard ahead of the billing permission check', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'user-1',
        role: 'owner',
        organizationId: 'org-1',
        mfaEnabled: true,
        mfaVerified: false,
      },
    });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('MFA_REQUIRED');
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });
});
