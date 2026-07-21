/**
 * Tests for POST /api/billing/subscription/cancel-scheduled-change.
 *
 * Releases a pending Stripe Subscription Schedule and clears the local
 * `scheduled*` columns — the live plan is never touched (it always
 * represented what stays live). Must:
 *   - 409 when there is no `stripeScheduleId` (nothing to cancel).
 *   - Release the schedule and clear exactly the five `scheduled*` columns.
 *   - Enforce the F-012 admin + auth guard, consistent with sibling routes.
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
  };
  const stripeMock = {
    subscriptionSchedules: { release: vi.fn() },
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

const SCHEDULED_SUB = {
  id: 'sub-row-1',
  stripeScheduleId: 'sub_sched_1',
};

function makeReq(): Request {
  return { headers: new Headers() } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: 'org-1' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
});

// ---------------------------------------------------------------------------
// RBAC: billing.* is reserved for owner + finance. Regression guard for the
// isAdminRole → authorize('billing.edit') migration.
// ---------------------------------------------------------------------------
describe('POST /api/billing/subscription/cancel-scheduled-change — RBAC (billing.edit registry enforcement)', () => {
  it.each(['supervisor', 'hr', 'clinical_director'])(
    'denies role=%s with 403 and never touches Stripe or the subscription row',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationId: 'org-1' } });

      const res = await POST(makeReq() as never);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
      expect(stripeMock.subscriptionSchedules.release).not.toHaveBeenCalled();
    },
  );

  it('allows role=finance through to the normal cancel-scheduled-change path', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'finance', organizationId: 'org-1' },
    });
    prismaMock.subscription.findUnique.mockResolvedValue(SCHEDULED_SUB);
    stripeMock.subscriptionSchedules.release.mockResolvedValue({});

    const res = await POST(makeReq() as never);

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched_1');
  });
});

describe('POST /api/billing/subscription/cancel-scheduled-change', () => {
  it('releases the schedule and clears exactly the five scheduled* columns', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(SCHEDULED_SUB);
    stripeMock.subscriptionSchedules.release.mockResolvedValue({});

    const res = await POST(makeReq() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched_1');
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
    expect(body).toEqual({
      message: 'Your scheduled plan change has been canceled.',
      success: true,
    });
  });

  it('records an audit entry on success', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(SCHEDULED_SUB);
    stripeMock.subscriptionSchedules.release.mockResolvedValue({});

    await POST(makeReq() as never);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.cancel_scheduled_change',
        organizationId: 'org-1',
        targetId: 'sub-row-1',
      }),
    );
  });

  it('returns 409 and does not touch Stripe when there is no pending schedule', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      id: 'sub-row-1',
      stripeScheduleId: null,
    });

    const res = await POST(makeReq() as never);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/no scheduled plan change/i);
    expect(stripeMock.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the org has no subscription row', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq() as never);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no active subscription found/i);
    expect(stripeMock.subscriptionSchedules.release).not.toHaveBeenCalled();
  });

  it('returns 404 when the user has no organization', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner', organizationId: null } });

    const res = await POST(makeReq() as never);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no organization found/i);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq() as never);

    expect(res.status).toBe(401);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('returns 401/403 (guard-rejected) when the session role is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', role: 'nurse' } });

    const res = await POST(makeReq() as never);

    expect([401, 403]).toContain(res.status);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('returns 500 and leaves the DB untouched when Stripe release throws', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(SCHEDULED_SUB);
    stripeMock.subscriptionSchedules.release.mockRejectedValue(new Error('Stripe API error'));

    const res = await POST(makeReq() as never);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/internal server error/i);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });
});
