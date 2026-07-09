/**
 * THER-010 regression test — protects the canonical subscription row from
 * last-writer-wins clobbering by a stale/superseded Stripe subscription
 * webhook event.
 *
 * Scenario guarded: after a THER-001 plan swap, Stripe may still deliver a
 * lagging event for the OLD subscription id (e.g. a duplicate created before
 * the swap, now being canceled). If that event's status is not itself
 * active/trialing and its subscription id differs from the org's current
 * canonical stripeSubscriptionId, it must be ignored — otherwise it would
 * overwrite the current plan/status and make the UI flip-flop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { prismaMock, stripeMock } = vi.hoisted(() => {
  // The route reads STRIPE_WEBHOOK_SECRET at module-evaluation time (not per
  // request), so it must be set before `import { POST } from './route'`
  // below runs. vi.hoisted() bodies run before imports, so this is the spot.
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

  const prismaMock = {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    subscription: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    invoice: { upsert: vi.fn() },
    processedWebhookEvent: { findUnique: vi.fn(), create: vi.fn() },
  };
  const stripeMock = {
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
  };
  return { prismaMock, stripeMock };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ getStripeClient: () => stripeMock, default: stripeMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(rawBody: string): NextRequest {
  return {
    text: vi.fn().mockResolvedValue(rawBody),
    headers: { get: vi.fn().mockReturnValue('sig_test') },
  } as unknown as NextRequest;
}

function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_new',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    pause_collection: null,
    metadata: { planKey: 'professional', billingCycle: 'monthly' },
    items: {
      data: [
        {
          price: { id: 'price_pro_monthly' },
          current_period_start: 1700000000,
          current_period_end: 1702592000,
        },
      ],
    },
    billing_cycle_anchor: 1700000000,
    // No active discount by default; individual discount-persistence tests
    // override this with populated Stripe discount ID strings.
    discounts: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organization.findUnique.mockResolvedValue({ id: 'org-1' });
  prismaMock.organization.update.mockResolvedValue({});
  prismaMock.subscription.upsert.mockResolvedValue({});
  // Idempotency ledger: default to "not yet seen" so events process, and a
  // successful record.
  prismaMock.processedWebhookEvent.findUnique.mockResolvedValue(null);
  prismaMock.processedWebhookEvent.create.mockResolvedValue({});
});

describe('POST /api/webhooks/stripe — THER-010 canonical row protection', () => {
  it('ignores a non-active event for a DIFFERENT (superseded) subscription id', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      pausedAt: null,
      pauseEndsAt: null,
      stripeSubscriptionId: 'sub_current', // canonical row already points elsewhere
    });

    const incoming = stripeSubscription({ id: 'sub_old_duplicate', status: 'canceled' });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: incoming },
    });

    const res = await POST(makeReq('{}'));

    expect(res.status).toBe(200);
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it('allows an incoming ACTIVE event for a different subscription id through (becomes canonical)', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      pausedAt: null,
      pauseEndsAt: null,
      stripeSubscriptionId: 'sub_current',
    });

    const incoming = stripeSubscription({ id: 'sub_new_active', status: 'active' });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: incoming },
    });

    await POST(makeReq('{}'));

    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
        update: expect.objectContaining({
          stripeSubscriptionId: 'sub_new_active',
          status: 'active',
        }),
      }),
    );
  });

  it('processes a non-active event when the subscription id MATCHES the canonical row (not a duplicate)', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      pausedAt: null,
      pauseEndsAt: null,
      stripeSubscriptionId: 'sub_current',
    });

    const incoming = stripeSubscription({ id: 'sub_current', status: 'past_due' });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: incoming },
    });

    await POST(makeReq('{}'));

    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          stripeSubscriptionId: 'sub_current',
          status: 'past_due',
        }),
      }),
    );
  });

  it('processes a non-active event when there is no prior canonical subscription row', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const incoming = stripeSubscription({ id: 'sub_brand_new', status: 'incomplete' });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.created',
      data: { object: incoming },
    });

    await POST(makeReq('{}'));

    expect(prismaMock.subscription.upsert).toHaveBeenCalledOnce();
  });
});

describe('POST /api/webhooks/stripe — F-014 idempotency', () => {
  it('short-circuits with 200 and does NOT re-process an event already in the ledger', async () => {
    prismaMock.processedWebhookEvent.findUnique.mockResolvedValue({ id: 'row-1' });

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_dup',
      type: 'customer.subscription.updated',
      data: { object: stripeSubscription() },
    });

    const res = await POST(makeReq('{}'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: true });
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
    expect(prismaMock.processedWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('records the event id in the ledger after successful processing', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_ok',
      type: 'customer.subscription.updated',
      data: { object: stripeSubscription() },
    });

    const res = await POST(makeReq('{}'));

    expect(res.status).toBe(200);
    expect(prismaMock.processedWebhookEvent.create).toHaveBeenCalledWith({
      data: { stripeEventId: 'evt_ok', eventType: 'customer.subscription.updated' },
    });
  });

  it('treats a concurrent duplicate (P2002 on record) as already-processed → 200', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);
    // Ledger findUnique says "not seen", but the create races another delivery.
    prismaMock.processedWebhookEvent.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_race',
      type: 'customer.subscription.updated',
      data: { object: stripeSubscription() },
    });

    const res = await POST(makeReq('{}'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: true });
  });
});

describe('POST /api/webhooks/stripe — F-014 retryable errors', () => {
  it('returns 5xx (so Stripe retries) when processing throws a transient/DB error', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);
    // A DB failure inside the handler — recoverable, must NOT be swallowed.
    prismaMock.subscription.upsert.mockRejectedValue(new Error('DB connection lost'));

    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_fail',
      type: 'customer.subscription.updated',
      data: { object: stripeSubscription() },
    });

    const res = await POST(makeReq('{}'));

    expect(res.status).toBe(500);
    // The event must NOT be recorded as processed when the handler failed, so a
    // redelivery can succeed.
    expect(prismaMock.processedWebhookEvent.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/stripe — discount persistence', () => {
  it('expands the subscription and persists promo code + percent-off + end date when a discount is present', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const incoming = stripeSubscription({ id: 'sub_promo', discounts: ['di_1'] });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_promo',
      type: 'customer.subscription.updated',
      data: { object: incoming },
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      discounts: [
        {
          source: {
            coupon: {
              name: 'Launch Promo',
              percent_off: 100,
              amount_off: null,
              currency: null,
              duration: 'repeating',
            },
          },
          promotion_code: { code: 'LAUNCH100' },
          end: 1735689600,
        },
      ],
    });

    const res = await POST(makeReq('{}'));

    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledWith('sub_promo', {
      expand: ['discounts.promotion_code', 'discounts.source.coupon'],
    });

    const expectedDiscountFields = {
      discountPromoCode: 'LAUNCH100',
      discountCouponName: 'Launch Promo',
      discountPercentOff: 100,
      discountAmountOff: null,
      discountCurrency: null,
      discountDuration: 'repeating',
      discountEndsAt: new Date(1735689600 * 1000),
    };
    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining(expectedDiscountFields),
        update: expect.objectContaining(expectedDiscountFields),
      }),
    );
  });

  it('falls back to the coupon name when a bare coupon is applied from the dashboard (no promotion code)', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const incoming = stripeSubscription({ id: 'sub_dashboard_coupon', discounts: ['di_2'] });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_dashboard_coupon',
      type: 'customer.subscription.updated',
      data: { object: incoming },
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      discounts: [
        {
          source: {
            coupon: {
              name: 'Dashboard Coupon',
              percent_off: 50,
              amount_off: null,
              currency: null,
              duration: 'forever',
            },
          },
          promotion_code: null,
          end: null,
        },
      ],
    });

    await POST(makeReq('{}'));

    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          discountPromoCode: null,
          discountCouponName: 'Dashboard Coupon',
          discountEndsAt: null,
        }),
      }),
    );
  });

  it('does not retrieve the subscription and clears all discount fields when discounts is empty', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const incoming = stripeSubscription({ id: 'sub_no_promo', discounts: [] });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_no_promo',
      type: 'customer.subscription.updated',
      data: { object: incoming },
    });

    await POST(makeReq('{}'));

    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();

    const noDiscount = {
      discountPromoCode: null,
      discountCouponName: null,
      discountPercentOff: null,
      discountAmountOff: null,
      discountCurrency: null,
      discountDuration: null,
      discountEndsAt: null,
    };
    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining(noDiscount),
        update: expect.objectContaining(noDiscount),
      }),
    );
  });

  it('returns 500 and leaves the event unrecorded (redelivery-safe) when the expand retrieve rejects', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);

    const incoming = stripeSubscription({ id: 'sub_retrieve_fails', discounts: ['di_3'] });
    stripeMock.webhooks.constructEvent.mockReturnValue({
      id: 'evt_retrieve_fails',
      type: 'customer.subscription.updated',
      data: { object: incoming },
    });
    stripeMock.subscriptions.retrieve.mockRejectedValue(new Error('Stripe API error'));

    const res = await POST(makeReq('{}'));

    expect(res.status).toBe(500);
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
    expect(prismaMock.processedWebhookEvent.create).not.toHaveBeenCalled();
  });
});
