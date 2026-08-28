/**
 * DashboardLayout renders a SITE-WIDE hard-escalation banner
 * (StatusTrackerAlertBanner) via getStatusTrackerSummaryForOrg. Before this
 * branch the call passed no facility argument at all — an org-wide leak for
 * every facility-bound viewer holding assignment.read (a supervisor), who
 * would see the organisation's hard-escalation count rather than their own
 * facilities'. These tests pin that the banner's count is now derived from
 * `resolveDataFacilityIds`, scoped for a facility-bound role and left
 * byte-identical (undefined — no predicate) for an org-wide one.
 */
import type { JSX } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockRedirect,
  prismaMock,
  mockResolveMembershipForActiveSession,
  mockResolveMemberFacilityId,
  mockResolveDataFacilityIds,
  mockGetStatusTrackerSummaryForOrg,
  mockGetPauseState,
  mockHasPendingPause,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  prismaMock: {
    user: { findUnique: vi.fn() },
    facility: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  mockResolveMembershipForActiveSession: vi.fn(),
  mockResolveMemberFacilityId: vi.fn(),
  mockResolveDataFacilityIds: vi.fn(),
  mockGetStatusTrackerSummaryForOrg: vi.fn(),
  mockGetPauseState: vi.fn(() => 'none'),
  mockHasPendingPause: vi.fn(() => false),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/auth/membership', () => ({
  resolveMembershipForActiveSession: mockResolveMembershipForActiveSession,
}));
vi.mock('@/lib/facility/member-facility', () => ({
  resolveMemberFacilityId: mockResolveMemberFacilityId,
}));
vi.mock('@/lib/facility/staff-where', () => ({
  resolveDataFacilityIds: mockResolveDataFacilityIds,
}));
vi.mock('@/lib/reminders/status-tracker', () => ({
  getStatusTrackerSummaryForOrg: mockGetStatusTrackerSummaryForOrg,
}));
// layout.tsx reads BOTH: getPauseState covers a live pause, hasPendingPause the
// scheduled-but-not-yet-active one. Mocking only the first leaves the second
// undefined, which throws and takes every test in this file down with it.
vi.mock('@/lib/billing', () => ({
  getPauseState: mockGetPauseState,
  hasPendingPause: mockHasPendingPause,
}));
vi.mock('@/components/dashboard/DashboardLayoutClient', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout-client">{children}</div>
  ),
}));
vi.mock('@/components/dashboard/OrganizationActivationModal', () => ({ default: () => null }));
vi.mock('@/components/providers/AdminSessionProvider', () => ({
  AdminSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/dashboard/auditor/ExportJobsProvider', () => ({
  ExportJobsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/billing/BillingPausedBanner', () => ({ default: () => null }));
const mockStatusTrackerAlertBanner = vi.fn<(props: unknown) => JSX.Element>(() => (
  <div data-testid="escalation-banner" />
));
vi.mock('@/components/dashboard/StatusTrackerAlertBanner', () => ({
  default: (props: unknown) => mockStatusTrackerAlertBanner(props),
}));

import DashboardLayout from './layout';

const ORG_ID = 'org-42';

function session(role: string, organizationId: string | null = ORG_ID) {
  return { user: { id: 'u1', email: 'user@test.com', name: 'User', role, organizationId } };
}

function membership(role: string, organizationUserId = 'ou-1') {
  return {
    organizationUserId,
    organizationId: ORG_ID,
    organizationName: 'Acme Corp',
    organizationSlug: 'acme',
    role,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPauseState.mockReturnValue('none');
  prismaMock.user.findUnique.mockResolvedValue({ fullName: 'Test User' });
  prismaMock.facility.findUnique.mockResolvedValue(null);
  prismaMock.organization.findUnique.mockResolvedValue({ subscription: null });
  mockResolveMemberFacilityId.mockResolvedValue(null);
  mockGetStatusTrackerSummaryForOrg.mockResolvedValue({ hardEscalationCount: 0 });
});

async function renderLayout() {
  const element = await DashboardLayout({ children: <div>content</div> });
  render(element);
}

describe('DashboardLayout — escalation banner facility scope', () => {
  it('an ORG-WIDE role (owner) gets the banner queried with NO facility predicate (undefined) — byte-identical to before', async () => {
    mockAuth.mockResolvedValue(session('owner'));
    mockResolveMembershipForActiveSession.mockResolvedValue(membership('owner'));
    mockResolveDataFacilityIds.mockResolvedValue(null);

    await renderLayout();

    expect(mockGetStatusTrackerSummaryForOrg).toHaveBeenCalledWith(ORG_ID, undefined, undefined);
  });

  it('THE LEAK FIX: a FACILITY-BOUND role (supervisor) gets the banner scoped to their own facilities, never org-wide', async () => {
    mockAuth.mockResolvedValue(session('supervisor'));
    mockResolveMembershipForActiveSession.mockResolvedValue(membership('supervisor'));
    mockResolveDataFacilityIds.mockResolvedValue(['fac-1']);

    await renderLayout();

    expect(mockGetStatusTrackerSummaryForOrg).toHaveBeenCalledWith(ORG_ID, undefined, ['fac-1']);
  });

  it('FAIL-CLOSED: a facility-bound role with zero accessible facilities gets an empty-array scope, not undefined (org-wide)', async () => {
    mockAuth.mockResolvedValue(session('supervisor'));
    mockResolveMembershipForActiveSession.mockResolvedValue(membership('supervisor'));
    mockResolveDataFacilityIds.mockResolvedValue([]);

    await renderLayout();

    expect(mockGetStatusTrackerSummaryForOrg).toHaveBeenCalledWith(ORG_ID, undefined, []);
  });

  it('never queries the banner summary for a role without assignment.read (finance)', async () => {
    mockAuth.mockResolvedValue(session('finance'));
    mockResolveMembershipForActiveSession.mockResolvedValue(membership('finance'));

    await renderLayout();

    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
    expect(mockResolveDataFacilityIds).not.toHaveBeenCalled();
    expect(screen.queryByTestId('escalation-banner')).not.toBeInTheDocument();
  });

  it('renders the banner with the fetched hardEscalationCount for an eligible role', async () => {
    mockAuth.mockResolvedValue(session('owner'));
    mockResolveMembershipForActiveSession.mockResolvedValue(membership('owner'));
    mockResolveDataFacilityIds.mockResolvedValue(null);
    mockGetStatusTrackerSummaryForOrg.mockResolvedValue({ hardEscalationCount: 5 });

    await renderLayout();

    expect(screen.getByTestId('escalation-banner')).toBeInTheDocument();
    expect(mockStatusTrackerAlertBanner).toHaveBeenCalledWith(
      expect.objectContaining({ hardEscalationCount: 5 }),
    );
  });

  it('redirects to /login before touching any of this when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(DashboardLayout({ children: <div /> })).rejects.toThrow('NEXT_REDIRECT');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });
});
