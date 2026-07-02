/**
 * THER-001 regression tests — P0 double-charge guard.
 *
 * The route must never open a second live Stripe subscription for an org
 * that already has one:
 *   - Existing non-canceled subscription with a stripeSubscriptionId →
 *     `stripe.subscriptions.update` (price swap, proration), NOT
 *     `stripe.checkout.sessions.create`. Returns { updated: true }.
 *   - No existing subscription (or a canceled one) → falls through to the
 *     create-checkout-session path. Returns { url }.
 *   - Already on the requested price and not scheduled to cancel → idempotent
 *     no-op; neither subscriptions.update nor checkout.sessions.create is
 *     called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAuth, prismaMock, stripeMock } = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const prismaMock = {
    user: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    subscription: { findUnique: vi.fn(), update: vi.fn() },
  };
  const stripeMock = {
    customers: { create: vi.fn() },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  };
  return { mockAuth, prismaMock, stripeMock };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ default: stripeMock }));
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
      monthlyPrice: 99,
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
      monthlyPrice: 149,
      isEnterprise: false,
      priceId: { monthly: 'price_pro_monthly', quarterly: 'price_pro_q', yearly: 'price_pro_y' },
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
const ORG = {
  name: 'Acme',
  primaryEmail: 'acme@example.com',
  stripeCustomerId: 'cus_123',
  // staffCount moved to Facility in the Org/Facility split; the route reads
  // organization.facilities[0].staffCount.
  facilities: [{ staffCount: '5' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
  prismaMock.organization.findUnique.mockResolvedValue(ORG);
});

describe('POST /api/billing/subscription/checkout — THER-001 double-charge guard', () => {
  it('swaps the price on an existing live subscription instead of creating a new Checkout session', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      status: 'active',
      stripeSubscriptionId: 'sub_existing',
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] },
      cancel_at_period_end: false,
    });

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'sub_existing',
      expect.objectContaining({
        items: [{ id: 'si_1', price: 'price_pro_monthly' }],
        proration_behavior: 'create_prorations',
      }),
    );
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: expect.objectContaining({ plan: 'professional', stripePriceId: 'price_pro_monthly' }),
    });
    expect(body).toEqual({ updated: true, message: 'Your plan has been updated.' });
  });

  it('creates a Checkout session (create path) when the org has no existing subscription', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_1',
    });

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(body).toEqual({ url: 'https://checkout.stripe.com/session_1' });
  });

  it('creates a Checkout session when the org has a CANCELED subscription (not "live")', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      status: 'canceled',
      stripeSubscriptionId: 'sub_old_canceled',
    });
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_2',
    });

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(body).toEqual({ url: 'https://checkout.stripe.com/session_2' });
  });

  it('is idempotent — no Stripe write at all when already on the requested price and not canceling', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      status: 'active',
      stripeSubscriptionId: 'sub_existing',
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', price: { id: 'price_pro_monthly' } }] },
      cancel_at_period_end: false,
    });

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    expect(body).toEqual({ updated: true, message: 'You are already on this plan.' });
  });

  it('swaps (does not no-op) when on the requested price but scheduled to cancel at period end', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      status: 'active',
      stripeSubscriptionId: 'sub_existing',
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', price: { id: 'price_pro_monthly' } }] },
      cancel_at_period_end: true,
    });

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'sub_existing',
      expect.objectContaining({ cancel_at_period_end: false }),
    );
    expect(body).toEqual({ updated: true, message: 'Your plan has been updated.' });
  });

  it('rejects a plan whose staffMax is below the facility staffCount — regression guard', async () => {
    // Org/Facility split regression guard: staffCount now lives on
    // organization.facilities[0], not organization.staffCount directly. If the
    // route regressed to reading `organization.staffCount` (a field removed
    // from Organization), that would be `undefined`, `parseInt(undefined ??
    // '0', 10)` would silently evaluate to 0, and this 422 would never fire —
    // letting an over-capacity org downgrade to a plan it doesn't fit.
    prismaMock.organization.findUnique.mockResolvedValue({
      ...ORG,
      facilities: [{ staffCount: '15' }], // exceeds starter's staffMax: 10
    });
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/too many staff/i);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('allows a plan whose staffMax comfortably covers the facility staffCount', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...ORG,
      facilities: [{ staffCount: '15' }],
    });
    prismaMock.subscription.findUnique.mockResolvedValue(null);
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_3',
    });

    // professional plan staffMax is 50, so 15 staff fits.
    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect(res.status).toBe(200);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledOnce();
  });

  it('returns 409 without touching Checkout when the live subscription has no line items', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      status: 'active',
      stripeSubscriptionId: 'sub_broken',
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));

    expect(res.status).toBe(409);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
