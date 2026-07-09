/**
 * Regression tests for POST /api/billing/subscription/reactivate.
 *
 * This route reverses a scheduled cancellation (clears
 * `cancel_at_period_end` in Stripe and `cancelAtPeriodEnd` in the DB) — the
 * "Resume subscription" action surfaced once the bug fix plumbed
 * `cancelAtPeriodEnd` through to the billing UI. It must:
 *   - Only act when the subscription is actually scheduled to cancel (409
 *     otherwise), and only when Stripe still considers it billable (active
 *     or trialing) — a fully-canceled subscription must resubscribe instead.
 *   - Never call Stripe when a guard rejects the request first.
 *   - Enforce the F-012 admin + auth guard, consistent with sibling routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAuth, prismaMock, stripeMock } = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const prismaMock = {
    user: { findUnique: vi.fn() },
    subscription: { findUnique: vi.fn(), update: vi.fn() },
  };
  const stripeMock = {
    subscriptions: { update: vi.fn() },
  };
  return { mockAuth, prismaMock, stripeMock };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ getStripeClient: () => stripeMock, default: stripeMock }));
// F-001 audit is a best-effort side-channel — stub it so the route tests
// don't depend on the audit sink or the request-scoped headers() it reads.
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
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

const CANCEL_SCHEDULED_SUB = {
  id: 'sub-row-1',
  organizationId: 'org-1',
  stripeSubscriptionId: 'sub_x',
  status: 'active',
  cancelAtPeriodEnd: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Session carries the `role` claim so the F-012 guardApiSession check
  // (auth + MFA + admin role, read from session claims) passes by default.
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
});

describe('POST /api/billing/subscription/reactivate', () => {
  it('clears a scheduled cancellation on an active subscription', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(CANCEL_SCHEDULED_SUB);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      cancel_at_period_end: false,
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: { cancelAtPeriodEnd: false },
    });
    expect(body).toEqual({ message: 'Subscription has been reactivated.', success: true });
  });

  it('clears a scheduled cancellation on a trialing subscription', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...CANCEL_SCHEDULED_SUB,
      status: 'trialing',
    });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_x', {
      cancel_at_period_end: false,
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledOnce();
  });

  it('returns 409 and does not touch Stripe when no cancellation is scheduled', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...CANCEL_SCHEDULED_SUB,
      cancelAtPeriodEnd: false,
    });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/not scheduled for cancellation/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  it.each(['canceled', 'past_due'])(
    'returns 409 and does not touch Stripe when status is %s',
    async (status) => {
      prismaMock.subscription.findUnique.mockResolvedValue({
        ...CANCEL_SCHEDULED_SUB,
        status,
      });

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toMatch(/can no longer be reactivated/i);
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
      expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    },
  );

  it('returns 404 when the org has no subscription row', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no active subscription found/i);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the user has no organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'owner', organizationId: null });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no organization found/i);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns 401/403 (guard-rejected) when the session role is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', role: 'nurse' } });

    const res = await POST();

    expect([401, 403]).toContain(res.status);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns 500 and does not update the DB when Stripe throws', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(CANCEL_SCHEDULED_SUB);
    stripeMock.subscriptions.update.mockRejectedValue(new Error('Stripe API error'));

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/internal server error/i);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });
});
