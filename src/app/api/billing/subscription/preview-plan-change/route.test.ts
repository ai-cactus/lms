/**
 * Tests for POST /api/billing/subscription/preview-plan-change.
 *
 * This route is read-only by design — it exists solely so the confirmation
 * dialog on the Subscription tab can show branch-appropriate copy BEFORE the
 * admin commits to a plan change. It must:
 *   - Classify via the same `classifyPlanChange` used by checkout.
 *   - Call `invoices.createPreview` ONLY for the immediate_prorate branch.
 *   - Never write to Stripe (no `subscriptions.update`, no schedule calls)
 *     and never call `audit()` — it is safe to fire on every plan-card click.
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
    subscription: { findUnique: vi.fn() },
  };
  const stripeMock = {
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    subscriptionSchedules: { create: vi.fn(), update: vi.fn(), release: vi.fn() },
    invoices: { createPreview: vi.fn() },
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
vi.mock('@/lib/billing-plans', () => ({
  BILLING_PLANS: [
    {
      key: 'starter',
      name: 'Starter',
      staffMin: 1,
      staffMax: 10,
      isEnterprise: false,
      priceId: {
        monthly: 'price_starter_monthly',
        quarterly: 'price_starter_q',
        yearly: 'price_starter_y',
      },
    },
    {
      key: 'professional',
      name: 'Professional',
      staffMin: 11,
      staffMax: 50,
      isEnterprise: false,
      priceId: { monthly: 'price_pro_monthly', quarterly: 'price_pro_q', yearly: 'price_pro_y' },
    },
    {
      key: 'enterprise',
      name: 'Enterprise',
      staffMin: 51,
      staffMax: null,
      isEnterprise: true,
      priceId: { monthly: null, quarterly: null, yearly: null },
    },
  ],
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

const ADMIN_USER = { role: 'owner', organizationId: 'org-1' };
const PERIOD_END_FAR_OUT = new Date('2026-12-17T12:00:00Z');

function liveSubscription(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    stripeSubscriptionId: 'sub_existing',
    plan: 'professional',
    billingCycle: 'monthly',
    currentPeriodEnd: PERIOD_END_FAR_OUT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
});

describe('POST /api/billing/subscription/preview-plan-change — classification', () => {
  it('returns no_op for the current plan/cycle', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      liveSubscription({ plan: 'professional', billingCycle: 'monthly' }),
    );

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ classification: 'no_op' });
    expect(stripeMock.invoices.createPreview).not.toHaveBeenCalled();
  });

  it('returns scheduled with the current period end as effectiveAt for a downgrade', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      liveSubscription({ plan: 'professional', billingCycle: 'monthly' }),
    );

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      classification: 'scheduled',
      effectiveAt: PERIOD_END_FAR_OUT.toISOString(),
    });
    expect(stripeMock.invoices.createPreview).not.toHaveBeenCalled();
  });

  it('returns scheduled (not immediate_prorate) for an upgrade with < 1 month remaining', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      liveSubscription({
        plan: 'starter',
        billingCycle: 'monthly',
        currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3), // 3 days out
      }),
    );

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(body.classification).toBe('scheduled');
    expect(stripeMock.invoices.createPreview).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/subscription/preview-plan-change — immediate_prorate branch', () => {
  it('calls invoices.createPreview and returns the amount due + currency for an upgrade', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      liveSubscription({ plan: 'starter', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] },
    });
    stripeMock.invoices.createPreview.mockResolvedValue({ amount_due: 5000, currency: 'usd' });

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(stripeMock.invoices.createPreview).toHaveBeenCalledWith({
      subscription: 'sub_existing',
      subscription_details: {
        items: [{ id: 'si_1', price: 'price_pro_monthly' }],
        proration_behavior: 'always_invoice',
      },
    });
    expect(body).toEqual({
      classification: 'immediate_prorate',
      amountDueCents: 5000,
      currency: 'usd',
    });
  });

  it('makes no Stripe write and no audit call at any point', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      liveSubscription({ plan: 'starter', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] },
    });
    stripeMock.invoices.createPreview.mockResolvedValue({ amount_due: 5000, currency: 'usd' });

    await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(stripeMock.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('returns 409 when the live subscription has no line items', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      liveSubscription({ plan: 'starter', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect(res.status).toBe(409);
    expect(stripeMock.invoices.createPreview).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/subscription/preview-plan-change — guards', () => {
  it('returns 404 when the org has no live subscription', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no active subscription/i);
  });

  it('returns 404 when the only subscription row is canceled', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(liveSubscription({ status: 'canceled' }));

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect(res.status).toBe(404);
  });

  it('returns 400 for an enterprise target (self-serve blocked)', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(liveSubscription());

    const res = await POST(makeReq({ planKey: 'enterprise', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/invalid plan/i);
  });

  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect(res.status).toBe(401);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('returns 401/403 (guard-rejected) when the session role is not admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', role: 'nurse' } });

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect([401, 403]).toContain(res.status);
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the user has no organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'owner', organizationId: null });

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no organization found/i);
  });

  it('returns 500 when the Stripe preview call throws', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      liveSubscription({ plan: 'starter', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] },
    });
    stripeMock.invoices.createPreview.mockRejectedValue(new Error('Stripe API error'));

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect(res.status).toBe(500);
  });
});
