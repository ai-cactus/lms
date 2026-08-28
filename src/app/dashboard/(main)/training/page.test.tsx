/**
 * TrainingPage was completely unguarded before this branch: any authenticated
 * session — Finance, a worker with a typed URL — reached the roster-wide
 * training figures via a bare `getDashboardData()` call with no facility
 * scoping at all. It now goes through `requirePermissionWithFacilityScope`,
 * which is unit-tested on its own (see require-permission.test.ts) — these
 * tests pin only that THIS page actually calls it (rather than, say, skipping
 * the gate on a refactor) and wires its resolved `dataFacilityIds` straight
 * into `getDashboardData`, never a bare unscoped call.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRequirePermissionWithFacilityScope, mockGetDashboardData } = vi.hoisted(() => ({
  mockRequirePermissionWithFacilityScope: vi.fn(),
  mockGetDashboardData: vi.fn(),
}));

vi.mock('@/lib/rbac/require-permission', () => ({
  requirePermissionWithFacilityScope: mockRequirePermissionWithFacilityScope,
}));
vi.mock('@/app/actions/course', () => ({ getDashboardData: mockGetDashboardData }));
vi.mock('./TrainingClient', () => ({
  default: ({ stats }: { stats: { totalCourses: number } }) => (
    <div data-testid="training-client">{stats.totalCourses}</div>
  ),
}));

import TrainingPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDashboardData.mockResolvedValue({
    courses: [],
    stats: { totalCourses: 3, totalStaffAssigned: 0, averageGrade: 0 },
  });
});

describe('TrainingPage', () => {
  it('requires course.read (with facility scope) before fetching anything', async () => {
    mockRequirePermissionWithFacilityScope.mockResolvedValue({ dataFacilityIds: null });

    await TrainingPage();

    expect(mockRequirePermissionWithFacilityScope).toHaveBeenCalledWith('course.read');
  });

  it('passes the resolved dataFacilityIds straight to getDashboardData — never a bare unscoped call', async () => {
    mockRequirePermissionWithFacilityScope.mockResolvedValue({ dataFacilityIds: ['fac-1'] });

    await TrainingPage();

    expect(mockGetDashboardData).toHaveBeenCalledWith(['fac-1']);
  });

  it('passes null through for an org-wide role (byte-identical to the unscoped org-wide query)', async () => {
    mockRequirePermissionWithFacilityScope.mockResolvedValue({ dataFacilityIds: null });

    await TrainingPage();

    expect(mockGetDashboardData).toHaveBeenCalledWith(null);
  });

  it('FAIL-CLOSED: passes an empty array through unchanged — never widened to null/undefined', async () => {
    mockRequirePermissionWithFacilityScope.mockResolvedValue({ dataFacilityIds: [] });

    await TrainingPage();

    expect(mockGetDashboardData).toHaveBeenCalledWith([]);
  });

  it('renders TrainingClient with the fetched course stats once authorized', async () => {
    mockRequirePermissionWithFacilityScope.mockResolvedValue({ dataFacilityIds: null });

    const element = await TrainingPage();
    render(element);

    expect(screen.getByTestId('training-client')).toHaveTextContent('3');
  });

  it('never fetches dashboard data when the permission gate denies (redirects) the caller', async () => {
    mockRequirePermissionWithFacilityScope.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(TrainingPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockGetDashboardData).not.toHaveBeenCalled();
  });
});
