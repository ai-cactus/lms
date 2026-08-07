/**
 * Regression tests for the /dashboard/status-tracker server gate.
 *
 * The page redirects to /dashboard unless the caller holds roster-wide
 * `assignment.read` visibility. Per the RBAC access matrix, owner, admin,
 * supervisor, hr and clinicalDirector hold it; finance (an admin-tier role)
 * and every worker role do not — direct navigation to this URL must bounce
 * them back to /dashboard rather than leaking the roster-wide overdue-training
 * table.
 *
 * Follows the same pattern as billing/page.test.tsx: call the exported async
 * Server Component directly and assert on the resolved element / thrown
 * redirect. Heavy children are stubbed.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockGetStatusTrackerSummaryForOrg, mockRedirect, makeSession } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockGetStatusTrackerSummaryForOrg: vi.fn(),
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
  }),
);

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/lib/reminders/status-tracker', () => ({
  getStatusTrackerSummaryForOrg: mockGetStatusTrackerSummaryForOrg,
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

      const element = await StatusTrackerPage();
      render(element);

      expect(screen.getByTestId('status-tracker-table')).toBeInTheDocument();
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );

  it('redirects finance to /dashboard (no roster-wide assignment visibility)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('finance'));

    await expect(StatusTrackerPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/dashboard');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });

  it('redirects a worker role (front_desk_admin) to /dashboard', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('front_desk_admin'));

    await expect(StatusTrackerPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/dashboard');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(StatusTrackerPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });
});
