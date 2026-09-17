/**
 * Regression tests for the /dashboard/status-tracker server gate.
 *
 * The page 404s unless the caller holds roster-wide `assignment.read`
 * visibility. Per the RBAC access matrix, owner, admin, supervisor, hr and
 * clinicalDirector hold it; finance (an admin-tier role) and every worker role
 * do not — direct navigation to this URL must answer "Page not found" rather
 * than leaking the roster-wide overdue-training table.
 *
 * The 404 (rather than the earlier bounce to /dashboard) is founder ruling Q26
 * (docs/local/RBAC-founder-answers-2026-09-15.md): a redirect still reveals
 * that a Status Tracker module exists.
 *
 * Follows the same pattern as billing/page.test.tsx: call the exported async
 * Server Component directly and assert on the resolved element / thrown
 * control-flow signal. Heavy children are stubbed.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockGetStatusTrackerSummaryForOrg, mockRedirect, mockNotFound, makeSession } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockGetStatusTrackerSummaryForOrg: vi.fn(),
    mockRedirect: vi.fn(() => {
      throw new Error('NEXT_REDIRECT');
    }),
    mockNotFound: vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
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
vi.mock('next/navigation', () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock('@/lib/reminders/status-tracker', () => ({
  getStatusTrackerSummaryForOrg: mockGetStatusTrackerSummaryForOrg,
}));
vi.mock('@/lib/facility/scope', () => ({
  listAccessibleFacilities: vi.fn().mockResolvedValue([]),
  resolveFacilityScopeSelection: vi.fn().mockResolvedValue({ mode: 'all' }),
  // D-01: the page now resolves facility scope through
  // requirePermissionWithFacilityScope, which consults this.
  isOrgWideFacilityRole: (role: string) =>
    ['owner', 'admin', 'hr', 'clinical_director', 'finance'].includes(role),
}));
vi.mock('@/components/dashboard/FacilityScopeSwitcher', () => ({
  default: () => <div data-testid="facility-scope-switcher" />,
}));
vi.mock('@/components/dashboard/status-tracker/StatusTrackerTableClient', () => ({
  default: () => <div data-testid="status-tracker-table" />,
}));

import StatusTrackerPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(makeSession('owner'));
  mockGetStatusTrackerSummaryForOrg.mockResolvedValue({
    overdueCount: 0,
    hardEscalationCount: 0,
    rows: [],
    nearDeadline: { count: 0, rows: [] },
  });
});

describe('StatusTrackerPage — assignment.read gate', () => {
  it.each(['owner', 'admin', 'supervisor', 'hr', 'clinical_director'])(
    'renders the real Status Tracker page for %s',
    async (role) => {
      mockAuth.mockResolvedValueOnce(makeSession(role));

      const element = await StatusTrackerPage({ searchParams: Promise.resolve({}) });
      render(element);

      expect(screen.getByTestId('status-tracker-table')).toBeInTheDocument();
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );

  // Q26: the assertion that matters is the pair — 404 fired AND no redirect. The
  // `notFound` half alone would still pass if the option were dropped and the
  // guard bounced to /dashboard instead.
  it('404s finance (no roster-wide assignment visibility)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('finance'));

    await expect(StatusTrackerPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );

    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });

  it('404s a worker role (front_desk_admin)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('front_desk_admin'));

    await expect(StatusTrackerPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );

    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(StatusTrackerPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });
});
