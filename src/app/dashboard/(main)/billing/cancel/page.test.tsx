/**
 * The cancel-subscription page gate.
 *
 * It was gated on `isAdminRole`, which admits HR, supervisor and
 * clinical_director — none of which holds any `billing.*` grant. The cancel API
 * behind the page correctly requires `billing.edit`, so the action itself was
 * never reachable; but the PAGE loaded and rendered the organisation's plan,
 * period end and cancellation state to roles with no billing access at all.
 *
 * The gate now names the same verb the API requires, so the page is only
 * reachable by someone who could actually complete the flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { organization: { findUnique: vi.fn() } },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/components/billing/CancelSubscriptionClient', () => ({
  default: () => <div data-testid="cancel-client" />,
}));

import CancelSubscriptionPage from './page';

const ORG_ID = 'org-1';

function session(role: string) {
  return { user: { id: 'u-1', role, organizationId: ORG_ID } };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organization.findUnique.mockResolvedValue({
    subscription: {
      plan: 'growth',
      status: 'active',
      currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      pausedAt: null,
      pauseEndsAt: null,
      pauseStartsAt: null,
    },
  });
});

describe('CancelSubscriptionPage gate', () => {
  it.each(['hr', 'supervisor', 'clinical_director'])(
    'redirects %s away — admin-tier, but holds no billing grant',
    async (role) => {
      mockAuth.mockResolvedValue(session(role));

      await expect(CancelSubscriptionPage()).rejects.toThrow('NEXT_REDIRECT');
      expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'finance'])('admits %s, which holds billing.edit', async (role) => {
    mockAuth.mockResolvedValue(session(role));

    await expect(CancelSubscriptionPage()).resolves.toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('refuses the subscription read before it happens — no billing state leaks on the way out', async () => {
    mockAuth.mockResolvedValue(session('hr'));

    await expect(CancelSubscriptionPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });
});
