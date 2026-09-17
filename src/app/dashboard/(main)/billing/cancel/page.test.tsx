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
 *
 * Founder ruling Q26 (docs/local/RBAC-founder-answers-2026-09-15.md) then made
 * the RBAC refusal a 404 rather than a redirect. The BILLING-STATE redirects
 * (no subscription, already scheduled to cancel) are a different gate and stay
 * redirects — they answer "there is nothing here to cancel", not "you may not
 * be here".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { organization: { findUnique: vi.fn() } },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock('@/components/billing/CancelSubscriptionClient', () => ({
  default: () => <div data-testid="cancel-client" />,
}));

import CancelSubscriptionPage from './page';

const ORG_ID = 'org-1';

function session(role: string) {
  // `email` is required: evaluatePermission masks it into the denial warning.
  return { user: { id: 'u-1', email: 'gate@test.invalid', role, organizationId: ORG_ID } };
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
    '404s %s — admin-tier, but holds no billing grant',
    async (role) => {
      mockAuth.mockResolvedValue(session(role));

      // Q26: not a redirect. `mockRedirect` must stay untouched, or the default
      // `onDeny` has crept back and /dashboard once again confirms the page.
      await expect(CancelSubscriptionPage()).rejects.toThrow('NEXT_NOT_FOUND');
      expect(mockNotFound).toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
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

    await expect(CancelSubscriptionPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  // The billing-state gate is deliberately NOT part of Q26: it is a statement
  // about this organisation's subscription, not about what this role may see,
  // and billing-plan-change-and-gating.spec.ts pins the same redirect end-to-end.
  it('still REDIRECTS an owner to /dashboard/billing when there is nothing to cancel', async () => {
    mockAuth.mockResolvedValue(session('owner'));
    prismaMock.organization.findUnique.mockResolvedValue({ subscription: null });

    await expect(CancelSubscriptionPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard/billing');
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
