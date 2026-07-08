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
  mockListAvailableVideoCourses,
  mockGetStatusTrackerSummaryForOrg,
  mockHasActiveBilling,
  mockRedirect,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { user: { findUnique: vi.fn() } },
  mockGetDashboardData: vi.fn(),
  mockListAvailableVideoCourses: vi.fn(),
  mockGetStatusTrackerSummaryForOrg: vi.fn(),
  mockHasActiveBilling: vi.fn(() => false),
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/app/actions/course', () => ({ getDashboardData: mockGetDashboardData }));
vi.mock('@/app/actions/offering', () => ({
  listAvailableVideoCourses: mockListAvailableVideoCourses,
}));
vi.mock('@/lib/reminders/status-tracker', () => ({
  getStatusTrackerSummaryForOrg: mockGetStatusTrackerSummaryForOrg,
}));
vi.mock('@/lib/billing', () => ({ hasActiveBilling: mockHasActiveBilling }));

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
vi.mock('@/components/dashboard/courses/AvailableCoursesTable', () => ({
  default: () => <div data-testid="available-courses" />,
}));

const mockStatusTrackerOverview = vi.fn<(props: unknown) => JSX.Element>(() => (
  <div data-testid="status-tracker-overview" />
));
vi.mock('@/components/dashboard/status-tracker/StatusTrackerOverview', () => ({
  default: (props: unknown) => mockStatusTrackerOverview(props),
}));

import DashboardPage from './page';

const ADMIN_SESSION = { user: { id: 'admin-1', role: 'admin' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(ADMIN_SESSION);
  mockGetDashboardData.mockResolvedValue({
    courses: [],
    stats: { totalCourses: 0, totalStaffAssigned: 0, averageGrade: 0 },
  });
  mockListAvailableVideoCourses.mockResolvedValue([]);
  mockHasActiveBilling.mockReturnValue(false);
});

describe('DashboardPage — Status Tracker data wiring', () => {
  it('falls back to a zeroed summary and skips the fetch when organizationId is null', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ organizationId: null, organization: null });

    const element = await DashboardPage();
    render(element);

    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
    expect(screen.getByTestId('status-tracker-overview')).toBeInTheDocument();
    expect(mockStatusTrackerOverview).toHaveBeenCalledWith(
      expect.objectContaining({ overdueCount: 0, hardEscalationCount: 0, rows: [] }),
    );
  });

  it('falls back to a zeroed summary when the user lookup itself is null', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const element = await DashboardPage();
    render(element);

    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
    expect(mockStatusTrackerOverview).toHaveBeenCalledWith(
      expect.objectContaining({ overdueCount: 0, hardEscalationCount: 0, rows: [] }),
    );
  });

  it('fetches the summary for the resolved organizationId and serializes dueAt to an ISO string', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      organizationId: 'org-42',
      organization: { subscription: null },
    });
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
    });

    const element = await DashboardPage();
    render(element);

    expect(mockGetStatusTrackerSummaryForOrg).toHaveBeenCalledWith('org-42');
    expect(mockStatusTrackerOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        overdueCount: 2,
        hardEscalationCount: 1,
        rows: [
          expect.objectContaining({
            enrollmentId: 'e1',
            workerName: 'Alice',
            courseTitle: 'HIPAA Basics',
            dueAt: '2024-06-01T00:00:00.000Z',
            daysOverdue: 9,
          }),
        ],
      }),
    );
  });

  it('redirects workers away from the admin dashboard before any status-tracker fetch', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'worker-1', role: 'worker' } });

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/worker');
    expect(mockGetStatusTrackerSummaryForOrg).not.toHaveBeenCalled();
  });
});
