/**
 * Tests for POST /api/billing/subscription/checkout.
 *
 * Phase 4 / Issue 3 rewrote the "existing live subscription" path from a
 * single unconditional price swap into a three-way branch driven by
 * `classifyPlanChange` (see src/lib/billing-plan-change.ts):
 *   - `no_op`             — target equals the live plan/cycle (or, if a
 *                           change is already scheduled to it, nothing to
 *                           do); re-selecting the live plan while a change is
 *                           scheduled RELEASES the schedule instead.
 *   - `scheduled`         — creates/updates a Stripe Subscription Schedule and
 *                           writes ONLY the `scheduled*` DB columns — never
 *                           `plan`/`billingCycle`/`stripePriceId` — since
 *                           nothing changes live until the schedule transitions.
 *   - `immediate_prorate` — calls `subscriptions.update` with
 *                           `proration_behavior: 'always_invoice'` and
 *                           `payment_behavior: 'error_if_incomplete'`, tagged
 *                           with an idempotency key, and writes the live plan
 *                           columns on success; a declined card must leave the
 *                           subscription (and DB) completely untouched and
 *                           return 402.
 *
 * THER-001 (no second live subscription for an org that already has one) and
 * the staff-capacity / broken-subscription guards predate this change and are
 * re-verified here since the branch they live in was rewritten wholesale.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';

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
    subscriptionSchedules: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      release: vi.fn(),
    },
    checkout: { sessions: { create: vi.fn() } },
  };
  return { mockAuth, prismaMock, stripeMock };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ getStripeClient: () => stripeMock, default: stripeMock }));
// F-001 audit is a best-effort side-channel — stub it so the route tests don't
// depend on the audit sink or on the request mock carrying real headers.
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
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

const PERIOD_END_FAR_OUT = new Date('2026-12-17T12:00:00Z'); // >= 1 month from any test's implicit "now"

function existingSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-row-1',
    status: 'active',
    stripeSubscriptionId: 'sub_existing',
    plan: 'professional',
    billingCycle: 'monthly',
    currentPeriodEnd: PERIOD_END_FAR_OUT,
    stripeScheduleId: null,
    scheduledPlan: null,
    scheduledBillingCycle: null,
    scheduledEffectiveAt: null,
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function liveStripeSub(overrides: Record<string, unknown> = {}) {
  return {
    items: { data: [{ id: 'si_1', price: { id: 'price_pro_monthly' } }] },
    schedule: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Session now carries the `role` claim so the F-012 guardApiSession check
  // (auth + MFA + admin role, read from session claims) passes.
  mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN_USER);
  prismaMock.organization.findUnique.mockResolvedValue(ORG);
});

describe('POST /api/billing/subscription/checkout — create path (no existing subscription)', () => {
  it('creates a Checkout session when the org has no existing subscription', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_1',
    });

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ allow_promotion_codes: true }),
    );
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(body).toEqual({ url: 'https://checkout.stripe.com/session_1' });
  });

  it('creates a Checkout session when the org has a CANCELED subscription (not "live")', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({ status: 'canceled' }),
    );
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/session_2',
    });

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledOnce();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(body).toEqual({ url: 'https://checkout.stripe.com/session_2' });
  });

  it('rejects a plan whose staffMax is below the facility staffCount — regression guard', async () => {
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
});

describe('POST /api/billing/subscription/checkout — no_op branch', () => {
  it('is idempotent — no Stripe write at all when already on the requested plan/cycle', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({ plan: 'professional', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(liveStripeSub());

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    expect(body).toEqual({ updated: true, message: 'You are already on this plan.' });
  });

  it('is idempotent when the target already equals a pending scheduled change', async () => {
    const effectiveAt = new Date('2026-08-01T00:00:00Z');
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({
        plan: 'professional',
        billingCycle: 'monthly',
        stripeScheduleId: 'sub_sched_1',
        scheduledPlan: 'starter',
        scheduledBillingCycle: 'monthly',
        scheduledEffectiveAt: effectiveAt,
      }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(liveStripeSub());

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    expect(body).toEqual({
      scheduled: true,
      effectiveAt: effectiveAt.toISOString(),
      message: 'This plan change is already scheduled.',
    });
  });

  it('releases the pending schedule and clears ONLY the scheduled* columns when reverting to the live plan', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({
        plan: 'professional',
        billingCycle: 'monthly',
        stripeScheduleId: 'sub_sched_1',
        scheduledPlan: 'starter',
        scheduledBillingCycle: 'monthly',
        scheduledEffectiveAt: new Date('2026-08-01T00:00:00Z'),
      }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(liveStripeSub());
    stripeMock.subscriptionSchedules.release.mockResolvedValue({});

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

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
    // Never touches the live plan columns — the live plan never changed.
    const updateCall = prismaMock.subscription.update.mock.calls[0]![0];
    expect(updateCall.data).not.toHaveProperty('plan');
    expect(updateCall.data).not.toHaveProperty('billingCycle');
    expect(updateCall.data).not.toHaveProperty('stripePriceId');
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(body).toEqual({
      updated: true,
      message: 'Your scheduled plan change has been canceled.',
    });
  });
});

describe('POST /api/billing/subscription/checkout — scheduled branch', () => {
  it('writes ONLY the scheduled* columns for a same-tier cycle change (never plan/billingCycle/stripePriceId)', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({ plan: 'professional', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(liveStripeSub());
    stripeMock.subscriptionSchedules.create.mockResolvedValue({
      id: 'sub_sched_new',
      phases: [
        {
          items: [{ price: 'price_pro_monthly' }],
          start_date: 1_700_000_000,
          end_date: 1_702_592_000,
        },
      ],
    });
    stripeMock.subscriptionSchedules.update.mockResolvedValue({ id: 'sub_sched_new' });

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'yearly' }));
    const body = await res.json();

    expect(stripeMock.subscriptionSchedules.create).toHaveBeenCalledWith({
      from_subscription: 'sub_existing',
    });
    expect(stripeMock.subscriptionSchedules.update).toHaveBeenCalledWith(
      'sub_sched_new',
      expect.objectContaining({
        end_behavior: 'release',
        phases: [
          expect.objectContaining({ items: [{ price: 'price_pro_monthly' }] }),
          expect.objectContaining({
            items: [{ price: 'price_pro_y' }],
            duration: { interval: 'year', interval_count: 1 },
            proration_behavior: 'none',
          }),
        ],
      }),
    );
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: {
        scheduledPlan: 'professional',
        scheduledBillingCycle: 'yearly',
        scheduledPriceId: 'price_pro_y',
        scheduledEffectiveAt: PERIOD_END_FAR_OUT,
        stripeScheduleId: 'sub_sched_new',
      },
    });
    const updateCall = prismaMock.subscription.update.mock.calls[0]![0];
    expect(updateCall.data).not.toHaveProperty('plan');
    expect(updateCall.data).not.toHaveProperty('billingCycle');
    expect(updateCall.data).not.toHaveProperty('stripePriceId');
    // No charge today.
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(body).toEqual({
      scheduled: true,
      effectiveAt: PERIOD_END_FAR_OUT.toISOString(),
      message: 'Your plan change is scheduled for the end of your current billing period.',
    });
  });

  it('writes ONLY the scheduled* columns for a downgrade (any time remaining)', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({ plan: 'professional', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(liveStripeSub());
    stripeMock.subscriptionSchedules.create.mockResolvedValue({
      id: 'sub_sched_down',
      phases: [
        {
          items: [{ price: 'price_pro_monthly' }],
          start_date: 1_700_000_000,
          end_date: 1_702_592_000,
        },
      ],
    });
    stripeMock.subscriptionSchedules.update.mockResolvedValue({ id: 'sub_sched_down' });

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(body.scheduled).toBe(true);
    const updateCall = prismaMock.subscription.update.mock.calls[0]![0];
    expect(updateCall.data.scheduledPlan).toBe('starter');
    expect(updateCall.data).not.toHaveProperty('plan');
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it('updates an existing schedule in place (retrieve, not create) when one is already active', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({
        plan: 'professional',
        billingCycle: 'monthly',
        stripeScheduleId: 'sub_sched_existing',
      }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(liveStripeSub());
    stripeMock.subscriptionSchedules.retrieve.mockResolvedValue({
      id: 'sub_sched_existing',
      phases: [
        {
          items: [{ price: 'price_pro_monthly' }],
          start_date: 1_700_000_000,
          end_date: 1_702_592_000,
        },
      ],
    });
    stripeMock.subscriptionSchedules.update.mockResolvedValue({ id: 'sub_sched_existing' });

    await POST(makeReq({ planKey: 'professional', billingCycle: 'quarterly' }));

    expect(stripeMock.subscriptionSchedules.retrieve).toHaveBeenCalledWith('sub_sched_existing');
    expect(stripeMock.subscriptionSchedules.create).not.toHaveBeenCalled();
  });

  it('returns 409 without touching Checkout when the live subscription has no line items', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(existingSubscription());
    stripeMock.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });

    const res = await POST(makeReq({ planKey: 'starter', billingCycle: 'monthly' }));

    expect(res.status).toBe(409);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/subscription/checkout — immediate_prorate branch', () => {
  it('charges now with always_invoice + error_if_incomplete + an idempotency key, and writes the live plan columns on success', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({ plan: 'starter', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      liveStripeSub({ items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] } }),
    );
    stripeMock.subscriptions.update.mockResolvedValue({});

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      'sub_existing',
      expect.objectContaining({
        items: [{ id: 'si_1', price: 'price_pro_monthly' }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        cancel_at_period_end: false,
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    // Idempotency key must be stable per (org, plan, cycle, subscription
    // updatedAt) so a client retry of the same request doesn't double-charge.
    const idempotencyKey = stripeMock.subscriptions.update.mock.calls[0]![2].idempotencyKey;
    expect(idempotencyKey).toBe('org-1:professional:monthly:1782864000000');

    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: {
        plan: 'professional',
        billingCycle: 'monthly',
        stripePriceId: 'price_pro_monthly',
        cancelAtPeriodEnd: false,
        scheduledPlan: null,
        scheduledBillingCycle: null,
        scheduledPriceId: null,
        scheduledEffectiveAt: null,
        stripeScheduleId: null,
      },
    });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(body).toEqual({
      updated: true,
      message: 'Your plan has been updated and the prorated balance was charged.',
    });
  });

  it('releases a pending schedule FIRST so the immediate charge prorates against the still-live plan', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({
        plan: 'starter',
        billingCycle: 'monthly',
        stripeScheduleId: 'sub_sched_stale',
        scheduledPlan: 'starter',
        scheduledBillingCycle: 'yearly',
        scheduledEffectiveAt: new Date('2026-08-01T00:00:00Z'),
      }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      liveStripeSub({ items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] } }),
    );
    stripeMock.subscriptionSchedules.release.mockResolvedValue({});
    stripeMock.subscriptions.update.mockResolvedValue({});

    await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect(stripeMock.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched_stale');
    // The release call happens before the charge.
    const releaseOrder = stripeMock.subscriptionSchedules.release.mock.invocationCallOrder[0]!;
    const chargeOrder = stripeMock.subscriptions.update.mock.invocationCallOrder[0]!;
    expect(releaseOrder).toBeLessThan(chargeOrder);
  });

  it('returns 402 and leaves the subscription/DB completely untouched when the card is declined', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({ plan: 'starter', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      liveStripeSub({ items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] } }),
    );
    const declinedCharge = Object.create(Stripe.errors.StripeCardError.prototype);
    stripeMock.subscriptions.update.mockRejectedValue(declinedCharge);

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toMatch(/card was declined/i);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  it('returns 402 on a subscription_payment_intent_requires_action invalid-request error', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({ plan: 'starter', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      liveStripeSub({ items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] } }),
    );
    const requiresAction = Object.assign(
      Object.create(Stripe.errors.StripeInvalidRequestError.prototype),
      { code: 'subscription_payment_intent_requires_action' },
    );
    stripeMock.subscriptions.update.mockRejectedValue(requiresAction);

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));

    expect(res.status).toBe(402);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  it('returns 500 (not 402) and leaves the DB untouched for an unrelated Stripe error', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(
      existingSubscription({ plan: 'starter', billingCycle: 'monthly' }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      liveStripeSub({ items: { data: [{ id: 'si_1', price: { id: 'price_starter_monthly' } }] } }),
    );
    stripeMock.subscriptions.update.mockRejectedValue(new Error('Stripe API error'));

    const res = await POST(makeReq({ planKey: 'professional', billingCycle: 'monthly' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/internal server error/i);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });
});
