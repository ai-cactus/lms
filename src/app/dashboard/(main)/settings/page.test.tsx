/**
 * Regression tests for the /dashboard/settings server gate.
 *
 * Settings is owner-only by product decision (facility + team-access
 * management). Any other admin role reaching this route (supervisor, hr,
 * clinical_director, finance) must see the styled access-denied card instead
 * of the real Settings UI — mirroring the Billing route's gate pattern
 * (see ./../billing/page.test.tsx).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    invite: { findMany: vi.fn(), count: vi.fn() },
    facility: { findFirst: vi.fn() },
    subscription: { findUnique: vi.fn() },
  },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/components/dashboard/settings/SettingsClient', () => ({
  default: ({
    teamMembers,
    facility,
    planName,
    inviterRole,
  }: {
    teamMembers: Array<{ email: string }>;
    facility: { name: string } | null;
    planName: string;
    inviterRole: string;
  }) => (
    <div data-testid="settings-client">
      members {teamMembers.length} / facility {facility?.name ?? 'none'} / plan {planName || 'none'}{' '}
      / role {inviterRole}
    </div>
  ),
}));

import SettingsPageRoute from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.invite.findMany.mockResolvedValue([]);
  prismaMock.facility.findFirst.mockResolvedValue({
    id: 'facility-1',
    name: 'Acme Clinic',
    type: 'clinic',
  });
  prismaMock.subscription.findUnique.mockResolvedValue({ plan: 'professional', status: 'active' });
  prismaMock.user.count.mockResolvedValue(3);
  prismaMock.invite.count.mockResolvedValue(0);
});

describe('SettingsPageRoute — owner-only gate', () => {
  it('redirects to /login when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(SettingsPageRoute()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('redirects to /login when the session user no longer exists in the DB', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(SettingsPageRoute()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
  });

  it('renders the real Settings UI for owner', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'owner', organizationId: 'org-1' });

    const element = await SettingsPageRoute();
    render(element);

    expect(screen.getByTestId('settings-client')).toHaveTextContent('facility Acme Clinic');
    expect(screen.getByTestId('settings-client')).toHaveTextContent('role owner');
    expect(screen.queryByText(/don.t have access to settings/i)).not.toBeInTheDocument();
  });

  it.each(['supervisor', 'hr', 'clinical_director', 'finance'])(
    'renders the access-denied card instead of Settings for %s',
    async (role) => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ role, organizationId: 'org-1' });

      const element = await SettingsPageRoute();
      render(element);

      expect(screen.getByText(/don.t have access to settings/i)).toBeInTheDocument();
      expect(screen.queryByTestId('settings-client')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
        'href',
        '/dashboard',
      );
      // Denial happens before any organization-scoped queries fire.
      expect(prismaMock.facility.findFirst).not.toHaveBeenCalled();
    },
  );

  it('shows the "no organization" state for an owner with no organizationId', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'owner', organizationId: null });

    const element = await SettingsPageRoute();
    render(element);

    expect(screen.getByText(/no organization found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('settings-client')).not.toBeInTheDocument();
    expect(prismaMock.facility.findFirst).not.toHaveBeenCalled();
  });
});

describe('SettingsPageRoute — data shaping for the owner path', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'owner', organizationId: 'org-1' });
  });

  it('merges active members and non-duplicate pending admin invites into teamMembers', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      {
        id: 'u1',
        email: 'owner@acme.com',
        role: 'owner',
        lastLoginAt: null,
        profile: { fullName: 'Owner Person' },
      },
    ]);
    prismaMock.invite.findMany.mockResolvedValueOnce([
      { id: 'inv1', email: 'pending-hr@acme.com', role: 'hr' },
      // Already-accepted invite for an existing member email must be excluded.
      { id: 'inv2', email: 'owner@acme.com', role: 'owner' },
    ]);

    const element = await SettingsPageRoute();
    render(element);

    // 1 active member + 1 genuinely-pending invite = 2, not 3.
    expect(screen.getByTestId('settings-client')).toHaveTextContent('members 2');
  });

  it('derives planLimit/planName only for a non-canceled subscription', async () => {
    prismaMock.subscription.findUnique.mockResolvedValueOnce({
      plan: 'professional',
      status: 'canceled',
    });

    const element = await SettingsPageRoute();
    render(element);

    expect(screen.getByTestId('settings-client')).toHaveTextContent('plan none');
  });
});
