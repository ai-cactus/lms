/**
 * Regression tests for the /dashboard/status-tracker server gate.
 *
 * The page now redirects to /dashboard unless the caller holds roster-wide
 * `assignment.read` visibility. Per the RBAC access matrix, owner, supervisor,
 * hr and clinicalDirector hold it; finance (an admin-tier role) and every
 * worker role do not — direct navigation to this URL must bounce them back to
 * /dashboard rather than leaking the roster-wide overdue-training table.
 *
 * Follows the same pattern as billing/page.test.tsx: call the exported async
 * Server Component directly and assert on the resolved element / thrown
 * redirect. Heavy children are stubbed.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockGetStatusTrackerSummaryForOrg, mockRedirect } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    prismaMock: { user: { findUnique: vi.fn() } },
    mockGetStatusTrackerSummaryForOrg: vi.fn(),
    mockRedirect: vi.fn(() => {
      throw new Error('NEXT_REDIRECT');
    }),
  }),
);

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
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
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  mockGetStatusTrackerSummaryForOrg.mockResolvedValue({
    overdueCount: 0,
    hardEscalationCount: 0,
    rows: [],
  });
});

describe('StatusTrackerPage — assignment.read gate', () => {
  it.each(['owner', 'supervisor', 'hr', 'clinical_director'])(
    'renders the real Status Tracker page for %s',
    async (role) => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ role, organizationId: 'org-1' });

      const element = await StatusTrackerPage();
      render(element);

      expect(screen.getByTestId('status-tracker-table')).toBeInTheDocument();
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );

  it('redirects finance to /dashboard (no roster-wide assignment visibility)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'finance',
      organizationId: 'org-1',
    });

    await expect(StatusTrackerPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/dashboard');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });

  it('redirects a worker role (front_desk_admin) to /dashboard', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'front_desk_admin',
      organizationId: 'org-1',
    });

    await expect(StatusTrackerPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/dashboard');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard when the user lookup is null', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(StatusTrackerPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/dashboard');
  });

  it('redirects to /login when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(StatusTrackerPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
