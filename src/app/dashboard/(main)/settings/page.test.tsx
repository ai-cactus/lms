/**
 * Regression tests for the /dashboard/settings server gate.
 *
 * Settings is gated on the granular `organization.edit` permission — owner
 * and admin (Owner-equivalent) hold it, every other admin role (supervisor,
 * hr, clinical_director, finance) must see the styled access-denied card
 * instead of the real Settings UI — mirroring the Billing route's gate
 * pattern (see ./../billing/page.test.tsx).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect, makeSession } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    organizationUser: { findMany: vi.fn(), count: vi.fn() },
    invite: { findMany: vi.fn(), count: vi.fn() },
    facility: { findMany: vi.fn() },
    subscription: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    notificationCategoryPreference: { findMany: vi.fn() },
  },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
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
vi.mock('@/components/dashboard/settings/SettingsClient', () => ({
  default: ({
    teamMembers,
    facilities,
    planName,
    inviterRole,
  }: {
    teamMembers: Array<{ email: string }>;
    facilities: Array<{ name: string; supervisorName: string | null }>;
    planName: string;
    inviterRole: string;
  }) => (
    <div data-testid="settings-client">
      members {teamMembers.length} / facility{' '}
      {facilities.map((f) => `${f.name}:${f.supervisorName ?? 'none'}`).join(', ') || 'none'} / plan{' '}
      {planName || 'none'} / role {inviterRole}
    </div>
  ),
}));

import SettingsPageRoute from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(makeSession('owner'));
  // Same mock backs both the admin-tier `members` query and the org-wide
  // `allMembers` (dedup) query in the page's Promise.all — default empty for
  // both; tests that care queue a `mockResolvedValueOnce` for the first call.
  prismaMock.organizationUser.findMany.mockResolvedValue([]);
  prismaMock.invite.findMany.mockResolvedValue([]);
  prismaMock.facility.findMany.mockResolvedValue([
    {
      id: 'facility-1',
      name: 'Acme Clinic',
      type: 'clinic',
      address: '1 Main St',
      userFacilities: [
        { organizationUser: { user: { fullName: 'Sasha Supervisor', email: 'sup@acme.com' } } },
      ],
    },
  ]);
  prismaMock.subscription.findUnique.mockResolvedValue({ plan: 'growth', status: 'active' });
  prismaMock.organization.findUnique.mockResolvedValue({ notificationDigestFrequency: 'daily' });
  prismaMock.notificationCategoryPreference.findMany.mockResolvedValue([]);
  prismaMock.organizationUser.count.mockResolvedValue(3);
  prismaMock.invite.count.mockResolvedValue(0);
});

describe('SettingsPageRoute — organization.edit gate', () => {
  it('redirects to /login when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(SettingsPageRoute()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(prismaMock.organizationUser.findMany).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])('renders the real Settings UI for %s', async (role) => {
    mockAuth.mockResolvedValueOnce(makeSession(role));

    const element = await SettingsPageRoute();
    render(element);

    expect(screen.getByTestId('settings-client')).toHaveTextContent(
      'facility Acme Clinic:Sasha Supervisor',
    );
    expect(screen.getByTestId('settings-client')).toHaveTextContent(`role ${role}`);
    expect(screen.queryByText(/don.t have access to settings/i)).not.toBeInTheDocument();
  });

  it.each(['supervisor', 'hr', 'clinical_director', 'finance'])(
    'renders the access-denied card instead of Settings for %s',
    async (role) => {
      mockAuth.mockResolvedValueOnce(makeSession(role));

      const element = await SettingsPageRoute();
      render(element);

      expect(screen.getByText(/don.t have access to settings/i)).toBeInTheDocument();
      expect(screen.queryByTestId('settings-client')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
        'href',
        '/dashboard',
      );
      // Denial happens before any organization-scoped queries fire.
      expect(prismaMock.facility.findMany).not.toHaveBeenCalled();
    },
  );

  it('shows the "no organization" state for an owner with no organizationId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('owner', { organizationId: null }));

    const element = await SettingsPageRoute();
    render(element);

    expect(screen.getByText(/no organization found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('settings-client')).not.toBeInTheDocument();
    expect(prismaMock.facility.findMany).not.toHaveBeenCalled();
  });
});

describe('SettingsPageRoute — data shaping for the owner path', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('owner'));
  });

  it('merges active members and non-duplicate pending admin invites into teamMembers', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValueOnce([
      {
        id: 'ou-owner-1',
        role: 'owner',
        lastLoginAt: null,
        user: { email: 'owner@acme.com', fullName: 'Owner Person' },
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
      plan: 'growth',
      status: 'canceled',
    });

    const element = await SettingsPageRoute();
    render(element);

    expect(screen.getByTestId('settings-client')).toHaveTextContent('plan none');
  });
});
