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
  };
  const stripeMock = {
    webhooks: { constructEvent: vi.fn() },
  };
  return { prismaMock, stripeMock };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ default: stripeMock }));
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organization.findUnique.mockResolvedValue({ id: 'org-1' });
  prismaMock.organization.update.mockResolvedValue({});
  prismaMock.subscription.upsert.mockResolvedValue({});
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
