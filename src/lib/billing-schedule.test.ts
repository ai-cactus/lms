/**
 * Unit tests for `releasePendingSchedule` — the read-before-act teardown that
 * lets cancel / resume / reactivate proceed when a plan-change schedule is
 * pending.
 *
 * The invariants under test are the ones that made the original bug possible:
 *  - a schedule Stripe already ended (or never had) must NOT be released again,
 *    but the stale local mirror must still be cleared; and
 *  - any other Stripe failure must propagate with the local mirror untouched,
 *    so a change we could not confirm gone upstream is never resolved locally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, stripeMock } = vi.hoisted(() => {
  const prismaMock = { subscription: { update: vi.fn() } };
  const stripeMock = {
    subscriptionSchedules: { retrieve: vi.fn(), release: vi.fn() },
  };
  return { prismaMock, stripeMock };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/stripe', () => ({ getStripeClient: () => stripeMock, default: stripeMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import { releasePendingSchedule } from './billing-schedule';

const CLEARED_COLUMNS = {
  where: { organizationId: 'org-1' },
  data: {
    scheduledPlan: null,
    scheduledBillingCycle: null,
    scheduledPriceId: null,
    scheduledEffectiveAt: null,
    stripeScheduleId: null,
  },
};

/** Mirrors the shape of a Stripe `resource_missing` invalid-request error. */
function resourceMissingError(): Error {
  return Object.assign(new Error('No such subscription schedule: sub_sched_1'), {
    code: 'resource_missing',
    type: 'StripeInvalidRequestError',
    statusCode: 404,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stripeMock.subscriptionSchedules.release.mockResolvedValue({});
  prismaMock.subscription.update.mockResolvedValue({});
});

describe('releasePendingSchedule — schedule is still live', () => {
  it.each(['not_started', 'active'])(
    'releases a schedule in status=%s and clears the local columns',
    async (status) => {
      stripeMock.subscriptionSchedules.retrieve.mockResolvedValue({ id: 'sub_sched_1', status });

      await expect(releasePendingSchedule('org-1', 'sub_sched_1')).resolves.toEqual({
        released: true,
      });

      expect(stripeMock.subscriptionSchedules.retrieve).toHaveBeenCalledWith('sub_sched_1');
      expect(stripeMock.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched_1');
      expect(prismaMock.subscription.update).toHaveBeenCalledWith(CLEARED_COLUMNS);
    },
  );
});

describe('releasePendingSchedule — schedule already gone (stale local mirror)', () => {
  it.each(['released', 'canceled', 'completed'])(
    'skips the release call for status=%s but still clears the local columns',
    async (status) => {
      stripeMock.subscriptionSchedules.retrieve.mockResolvedValue({ id: 'sub_sched_1', status });

      await expect(releasePendingSchedule('org-1', 'sub_sched_1')).resolves.toEqual({
        released: false,
      });

      expect(stripeMock.subscriptionSchedules.release).not.toHaveBeenCalled();
      expect(prismaMock.subscription.update).toHaveBeenCalledWith(CLEARED_COLUMNS);
    },
  );

  it('tolerates a resource_missing retrieve and clears the local columns', async () => {
    stripeMock.subscriptionSchedules.retrieve.mockRejectedValue(resourceMissingError());

    await expect(releasePendingSchedule('org-1', 'sub_sched_1')).resolves.toEqual({
      released: false,
    });

    expect(stripeMock.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).toHaveBeenCalledWith(CLEARED_COLUMNS);
  });
});

describe('releasePendingSchedule — upstream failures propagate', () => {
  it('rethrows a non-resource_missing retrieve failure and leaves the columns untouched', async () => {
    stripeMock.subscriptionSchedules.retrieve.mockRejectedValue(new Error('Stripe API error'));

    await expect(releasePendingSchedule('org-1', 'sub_sched_1')).rejects.toThrow(
      'Stripe API error',
    );

    expect(stripeMock.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  it('rethrows a release failure and leaves the columns untouched', async () => {
    stripeMock.subscriptionSchedules.retrieve.mockResolvedValue({
      id: 'sub_sched_1',
      status: 'active',
    });
    stripeMock.subscriptionSchedules.release.mockRejectedValue(new Error('Stripe API error'));

    await expect(releasePendingSchedule('org-1', 'sub_sched_1')).rejects.toThrow(
      'Stripe API error',
    );

    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });
});
