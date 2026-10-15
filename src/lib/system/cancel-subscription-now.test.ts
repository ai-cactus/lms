// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  retrieve: vi.fn(),
  cancel: vi.fn(),
  cancelSchedule: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({ logger: h.mockLogger }));
vi.mock('@/lib/stripe', () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: h.retrieve, cancel: h.cancel },
    subscriptionSchedules: { cancel: h.cancelSchedule },
  }),
}));

import { cancelStripeSubscriptionNow } from './cancel-subscription-now';

const ORG_ID = 'org-1';
const SUB_ID = 'sub_123';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  h.retrieve.mockResolvedValue({ id: SUB_ID, status: 'active', schedule: null });
  h.cancel.mockResolvedValue({ id: SUB_ID, status: 'canceled' });
  h.cancelSchedule.mockResolvedValue({ id: 'sub_sched_1', status: 'canceled' });
});

describe('cancelStripeSubscriptionNow', () => {
  it('throws without a Stripe key, before calling Stripe', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    await expect(cancelStripeSubscriptionNow(ORG_ID, SUB_ID)).rejects.toThrow(
      'STRIPE_SECRET_KEY is not configured',
    );
    expect(h.retrieve).not.toHaveBeenCalled();
  });

  it('cancels an active subscription immediately, with no credit or final invoice', async () => {
    await expect(cancelStripeSubscriptionNow(ORG_ID, SUB_ID)).resolves.toBe('cancelled');

    expect(h.cancel).toHaveBeenCalledWith(
      SUB_ID,
      {
        invoice_now: false,
        prorate: false,
        cancellation_details: { comment: 'Organization permanently deleted' },
      },
      { idempotencyKey: `org-hard-delete-cancel:${SUB_ID}` },
    );
    expect(h.cancelSchedule).not.toHaveBeenCalled();
  });

  it.each([
    ['an id', 'sub_sched_1'],
    ['an expanded object', { id: 'sub_sched_1' }],
  ])('cancels the managing schedule instead when it is %s', async (_label, schedule) => {
    h.retrieve.mockResolvedValue({ id: SUB_ID, status: 'active', schedule });

    await expect(cancelStripeSubscriptionNow(ORG_ID, SUB_ID)).resolves.toBe('cancelled');

    expect(h.cancelSchedule).toHaveBeenCalledWith(
      'sub_sched_1',
      { invoice_now: false, prorate: false },
      { idempotencyKey: 'org-hard-delete-cancel-schedule:sub_sched_1' },
    );
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it.each(['canceled', 'incomplete_expired'])(
    'treats a %s subscription as already cancelled',
    async (status) => {
      h.retrieve.mockResolvedValue({ id: SUB_ID, status, schedule: null });

      await expect(cancelStripeSubscriptionNow(ORG_ID, SUB_ID)).resolves.toBe('already_cancelled');
      expect(h.cancel).not.toHaveBeenCalled();
    },
  );

  it('treats a subscription Stripe no longer has as already cancelled', async () => {
    h.retrieve.mockRejectedValue(
      Object.assign(new Error('No such subscription'), {
        code: 'resource_missing',
      }),
    );

    await expect(cancelStripeSubscriptionNow(ORG_ID, SUB_ID)).resolves.toBe('already_cancelled');
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('propagates any other Stripe failure', async () => {
    h.retrieve.mockRejectedValue(Object.assign(new Error('rate limited'), { code: 'rate_limit' }));
    await expect(cancelStripeSubscriptionNow(ORG_ID, SUB_ID)).rejects.toThrow('rate limited');

    h.retrieve.mockResolvedValue({ id: SUB_ID, status: 'active', schedule: null });
    h.cancel.mockRejectedValue(new Error('api down'));
    await expect(cancelStripeSubscriptionNow(ORG_ID, SUB_ID)).rejects.toThrow('api down');
  });
});
