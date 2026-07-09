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

const { mockAuth, prismaMock, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { user: { findUnique: vi.fn() }, organization: { findUnique: vi.fn() } },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/components/billing/BillingPage', () => ({
  default: ({
    currentPlan,
    staffCount,
  }: {
    currentPlan: string | null;
    staffCount: number | null;
  }) => (
    <div data-testid="billing-page">
      plan {currentPlan ?? 'none'} / staff {staffCount ?? 'n/a'}
    </div>
  ),
}));

import BillingPageRoute from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  prismaMock.organization.findUnique.mockResolvedValue({
    facilities: [{ staffCount: 5 }],
    subscription: { plan: 'professional', status: 'active', pausedAt: null, pauseEndsAt: null },
  });
});

describe('BillingPageRoute — billing.read gate', () => {
  it.each(['owner', 'finance'])('renders the real billing UI for %s', async (role) => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role, organizationId: 'org-1' });

    const element = await BillingPageRoute();
    render(element);

    expect(screen.getByTestId('billing-page')).toHaveTextContent('plan professional');
    expect(screen.queryByText(/don.t have access to billing/i)).not.toBeInTheDocument();
  });

  it.each(['supervisor', 'hr'])(
    'renders the access-denied card instead of billing for %s',
    async (role) => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ role, organizationId: 'org-1' });

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
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
