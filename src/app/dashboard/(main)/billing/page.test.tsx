/**
 * Regression tests for the /dashboard/billing server gate.
 *
 * The gate switched from `isAdminRole(user.role)` (true for every admin role,
 * including supervisor) to `can(dbRoleToRoleKey(user.role), 'billing.read')`
 * — only `owner` and `finance` hold that permission. A role like `supervisor`
 * or `hr` reaching this route must now see the styled access-denied card
 * instead of the real billing UI.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect, mockGetPlanPrices, makeSession } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { organization: { findUnique: vi.fn() } },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  mockGetPlanPrices: vi.fn(),
  makeSession: (role: string, extras: Record<string, unknown> = {}) => ({
    user: {
      id: 'user-1',
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      role,
      email: 'x@acme.com',
      name: 'Test User',
      ...extras,
    },
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
// `@/lib/billing-prices` is `server-only` (throws when imported outside a
// React Server Component module graph — the `react-server` resolve condition
// Next sets isn't present under vitest/jsdom). This page test isn't
// exercising price-fetching behavior (that's covered by billing-prices.test.ts),
// so stub the module entirely rather than let the real one load.
vi.mock('@/lib/billing-prices', () => ({ getPlanPrices: mockGetPlanPrices }));
vi.mock('@/components/billing/BillingPage', () => ({
  default: ({
    currentPlan,
    staffCount,
    hasLiveSubscription,
    planPrices,
  }: {
    currentPlan: string | null;
    staffCount: number | null;
    hasLiveSubscription?: boolean;
    planPrices: unknown;
  }) => (
    <div data-testid="billing-page">
      plan {currentPlan ?? 'none'} / staff {staffCount ?? 'n/a'} / hasLiveSubscription{' '}
      {String(hasLiveSubscription)} / planPrices {planPrices ? 'present' : 'missing'}
    </div>
  ),
}));

import BillingPageRoute from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(makeSession('owner'));
  prismaMock.organization.findUnique.mockResolvedValue({
    facilities: [{ staffCount: 5 }],
    subscription: { plan: 'growth', status: 'active', pausedAt: null, pauseEndsAt: null },
  });
  mockGetPlanPrices.mockResolvedValue({ starter: {}, growth: {}, enterprise: {} });
});

describe('BillingPageRoute — billing.read gate', () => {
  // owner/admin (everything) and finance (explicit billing CRUD) hold billing.read.
  it.each(['owner', 'admin', 'finance'])('renders the real billing UI for %s', async (role) => {
    mockAuth.mockResolvedValueOnce(makeSession(role));

    const element = await BillingPageRoute();
    render(element);

    expect(screen.getByTestId('billing-page')).toHaveTextContent('plan growth');
    expect(screen.queryByText(/don.t have access to billing/i)).not.toBeInTheDocument();
  });

  // supervisor was demoted to read-only-minus-billing; hr never had billing access.
  it.each(['supervisor', 'hr'])(
    'renders the access-denied card instead of billing for %s',
    async (role) => {
      mockAuth.mockResolvedValueOnce(makeSession(role));

      const element = await BillingPageRoute();
      render(element);

      expect(screen.getByText(/don.t have access to billing/i)).toBeInTheDocument();
      expect(screen.queryByTestId('billing-page')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
        'href',
        '/dashboard',
      );
    },
  );

  it('redirects to /login when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(BillingPageRoute()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it('fetches live Stripe plan prices and passes them through to BillingPage', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('owner'));

    const element = await BillingPageRoute();
    render(element);

    expect(mockGetPlanPrices).toHaveBeenCalledOnce();
    expect(screen.getByTestId('billing-page')).toHaveTextContent('planPrices present');
  });

  it('does not call getPlanPrices for a role denied billing access', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('supervisor'));

    const element = await BillingPageRoute();
    render(element);

    expect(mockGetPlanPrices).not.toHaveBeenCalled();
  });
});

/**
 * Defect A — `hasLiveSubscription` computation (page.tsx):
 *   hasLiveSubscription = !!sub && sub.status !== 'canceled' && !!sub.stripeSubscriptionId
 *
 * This flag decides whether SubscriptionTab treats a plan click as an
 * in-place swap (confirmation dialog) or a fresh Checkout redirect — a wrong
 * value here would either skip the confirmation for a real swap or block a
 * genuinely new subscriber behind a dialog for a plan they don't have yet.
 */
describe('BillingPageRoute — hasLiveSubscription computation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValueOnce(makeSession('owner'));
  });

  it('is true for an active subscription with a live Stripe subscription id', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      facilities: [{ staffCount: 5 }],
      subscription: {
        plan: 'growth',
        status: 'active',
        pausedAt: null,
        pauseEndsAt: null,
        stripeSubscriptionId: 'sub_123',
      },
    });

    const element = await BillingPageRoute();
    render(element);

    expect(screen.getByTestId('billing-page')).toHaveTextContent('hasLiveSubscription true');
  });

  it('is true even while paused (Stripe keeps status active during a pause)', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      facilities: [{ staffCount: 5 }],
      subscription: {
        plan: 'growth',
        status: 'active',
        pausedAt: new Date('2026-01-01'),
        pauseEndsAt: new Date('2026-04-01'),
        stripeSubscriptionId: 'sub_123',
      },
    });

    const element = await BillingPageRoute();
    render(element);

    expect(screen.getByTestId('billing-page')).toHaveTextContent('hasLiveSubscription true');
  });

  it('is false for a canceled subscription even if a Stripe id lingers', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      facilities: [{ staffCount: 5 }],
      subscription: {
        plan: 'growth',
        status: 'canceled',
        pausedAt: null,
        pauseEndsAt: null,
        stripeSubscriptionId: 'sub_123',
      },
    });

    const element = await BillingPageRoute();
    render(element);

    expect(screen.getByTestId('billing-page')).toHaveTextContent('hasLiveSubscription false');
  });

  it('is false when there is no subscription row at all (brand-new subscriber)', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      facilities: [],
      subscription: null,
    });

    const element = await BillingPageRoute();
    render(element);

    expect(screen.getByTestId('billing-page')).toHaveTextContent('hasLiveSubscription false');
  });

  it('is false when the caller has no organization at all', async () => {
    mockAuth.mockReset().mockResolvedValueOnce(makeSession('owner', { organizationId: null }));

    const element = await BillingPageRoute();
    render(element);

    expect(screen.getByTestId('billing-page')).toHaveTextContent('hasLiveSubscription false');
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });
});
