/**
 * Data-wiring tests for the admin dashboard page's Status Tracker integration.
 *
 * The page is an async Server Component (pattern: call the exported function
 * directly, `render()` the returned element — see
 * src/app/join/[token]/page.test.tsx for precedent). Heavy/unrelated child
 * components are stubbed; StatusTrackerOverview is stubbed to a prop-capturing
 * spy so we can assert exactly what the page computed and serialized for it,
 * without depending on the widget's own rendering (covered separately in
 * StatusTrackerOverview.test.tsx).
 *
 * Focus: the `user?.organizationId ? … : { overdueCount: 0, hardEscalationCount: 0, rows: [] }`
 * fallback branch, and the Date → ISO string row serialization.
 */
import type { JSX } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  prismaMock,
  mockGetDashboardData,
  mockGetStatusTrackerSummaryForOrg,
  mockHasActiveBilling,
  mockRedirect,
  mockGetGlobalDashboardData,
  mockListAccessibleFacilities,
  mockResolveFacilityScope,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { organization: { findUnique: vi.fn() } },
  mockGetDashboardData: vi.fn(),
  mockGetStatusTrackerSummaryForOrg: vi.fn(),
  mockHasActiveBilling: vi.fn(() => false),
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  mockGetGlobalDashboardData: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockResolveFacilityScope: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/app/actions/course', () => ({ getDashboardData: mockGetDashboardData }));
vi.mock('@/lib/reminders/status-tracker', () => ({
  getStatusTrackerSummaryForOrg: mockGetStatusTrackerSummaryForOrg,
}));
vi.mock('@/lib/billing', () => ({ hasActiveBilling: mockHasActiveBilling }));
vi.mock('@/app/actions/dashboard-facility', () => ({
  getGlobalDashboardData: mockGetGlobalDashboardData,
}));
vi.mock('@/lib/facility/scope', () => ({
  listAccessibleFacilities: mockListAccessibleFacilities,
  resolveFacilityScope: mockResolveFacilityScope,
}));
vi.mock('@/components/dashboard/global/GlobalDashboardView', () => ({
  default: () => <div data-testid="global-dashboard" />,
}));
vi.mock('@/components/dashboard/FacilityScopeSwitcher', () => ({
  default: () => <div data-testid="facility-switcher" />,
}));

// Stub every child component — the page's own composition/data-wiring is under
// test, not the children's rendering (each has its own tests where relevant).
vi.mock('@/components/dashboard/DashboardChartsDynamic', () => ({
  default: () => <div data-testid="charts" />,
}));
vi.mock('@/components/dashboard/MyCoursesTable', () => ({
  default: () => <div data-testid="my-courses" />,
}));
vi.mock('@/components/dashboard/DashboardEmptyState', () => ({
  default: () => <div data-testid="empty-state" />,
}));
vi.mock('@/components/dashboard/DashboardCreateCourseButton', () => ({
  default: () => <button type="button">Create course</button>,
}));

const mockStatusTrackerOverview = vi.fn<(props: unknown) => JSX.Element>(() => (
  <div data-testid="status-tracker-overview" />
));
vi.mock('@/components/dashboard/status-tracker/StatusTrackerOverview', () => ({
  default: (props: unknown) => mockStatusTrackerOverview(props),
}));

import DashboardPage from './page';

// Session now carries role/organizationId directly (post multi-org refactor) —
// the page no longer performs a separate prisma.user.findUnique lookup for them.
const ADMIN_SESSION = {
  user: { id: 'admin-1', organizationUserId: 'ou-1', organizationId: 'org-42', role: 'owner' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(ADMIN_SESSION);
  prismaMock.organization.findUnique.mockResolvedValue({ subscription: null });
  mockGetDashboardData.mockResolvedValue({
    courses: [],
    stats: { totalCourses: 0, totalStaffAssigned: 0, averageGrade: 0 },
  });
  mockHasActiveBilling.mockReturnValue(false);
  mockResolveFacilityScope.mockResolvedValue({ mode: 'all' });
  mockListAccessibleFacilities.mockResolvedValue([]);
  // No facilities => the page keeps the organisation-wide dashboard, which is
  // the surface these tests exercise.
  mockGetGlobalDashboardData.mockResolvedValue({ facilities: [] });
});

/** The page reads only `searchParams.facility`; default to an unscoped request. */
const noSearchParams = () => ({ searchParams: Promise.resolve({}) });

describe('DashboardPage — Status Tracker data wiring', () => {
  it('falls back to a zeroed summary and skips the fetch when organizationId is null', async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 'admin-1', organizationUserId: 'ou-1', organizationId: null, role: 'owner' },
    });

    const element = await DashboardPage(noSearchParams());
    render(element);

    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    expect(screen.getByTestId('status-tracker-overview')).toBeInTheDocument();
    expect(mockStatusTrackerOverview).toHaveBeenCalledWith(expect.objectContaining({ rows: [] }));
  });

  it('fetches the summary for the resolved organizationId and serializes dueAt to an ISO string', async () => {
    mockGetStatusTrackerSummaryForOrg.mockResolvedValue({
      overdueCount: 2,
      hardEscalationCount: 1,
      rows: [
        {
          enrollmentId: 'e1',
          userId: 'u1',
          workerName: 'Alice',
          workerEmail: 'alice@test.com',
          courseId: 'c1',
          courseTitle: 'HIPAA Basics',
          dueAt: new Date('2024-06-01T00:00:00.000Z'),
          daysOverdue: 9,
          status: 'in_progress',
          managerName: null,
        },
      ],
      nearDeadline: {
        count: 1,
        rows: [
          {
            enrollmentId: 'e2',
            userId: 'u2',
            workerName: 'Bob',
            workerEmail: 'bob@test.com',
            courseId: 'c2',
            courseTitle: 'OSHA Refresher',
            dueAt: new Date('2024-06-05T00:00:00.000Z'),
            daysUntilDue: 3,
            status: 'assigned',
          },
        ],
      },
    });

    const element = await DashboardPage(noSearchParams());
    render(element);

    expect(mockGetStatusTrackerSummaryForOrg).toHaveBeenCalledWith(
      'org-42',
      expect.any(Date),
      undefined,
    );
    expect(mockStatusTrackerOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            enrollmentId: 'e1',
            userId: 'u1',
            workerName: 'Alice',
            workerEmail: 'alice@test.com',
            courseTitle: 'HIPAA Basics',
            dueAt: '2024-06-01T00:00:00.000Z',
            daysOverdue: 9,
            daysUntilDue: null,
          }),
          expect.objectContaining({
            enrollmentId: 'e2',
            userId: 'u2',
            workerName: 'Bob',
            courseTitle: 'OSHA Refresher',
            dueAt: '2024-06-05T00:00:00.000Z',
            daysOverdue: null,
            daysUntilDue: 3,
          }),
        ],
      }),
    );
  });

  it('redirects workers away from the admin dashboard before any status-tracker fetch', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'worker-1', role: 'nurse' } });

    await expect(DashboardPage(noSearchParams())).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/worker');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });

  it('skips the status-tracker fetch and widget for finance (no roster-wide assignment visibility)', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'finance-1',
        organizationUserId: 'ou-2',
        organizationId: 'org-42',
        role: 'finance',
      },
    });

    const element = await DashboardPage(noSearchParams());
    render(element);

    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
    expect(screen.queryByTestId('status-tracker-overview')).not.toBeInTheDocument();
  });
});
