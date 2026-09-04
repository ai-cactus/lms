/**
 * Removing a staff member did not free their seat.
 *
 * `removeStaff` DEACTIVATES a membership (`active: false`) rather than deleting
 * it, so the person's training record survives — and the canonical
 * `countBillableStaff` filters on `active: true` accordingly. This page,
 * however, hand-rolled its own copy of that count and had drifted from it: no
 * `active` filter, so removed staff kept consuming seats. The gauge never went
 * down and an org sitting at its plan cap could not invite anyone again even
 * with room on the roster (staging QA 2026-09-04).
 *
 * The page now calls the shared helper, so the two cannot drift again.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockRequirePermission, mockGetStaffUsers, mockCountBillableStaff } = vi.hoisted(
  () => ({
    prismaMock: {
      subscription: { findUnique: vi.fn() },
      invite: { count: vi.fn() },
    },
    mockRequirePermission: vi.fn(),
    mockGetStaffUsers: vi.fn(),
    mockCountBillableStaff: vi.fn(),
  }),
);

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/rbac/require-permission', () => ({
  requirePermissionWithFacilityScope: mockRequirePermission,
  requirePermission: mockRequirePermission,
}));
vi.mock('@/app/actions/user', () => ({ getStaffUsers: mockGetStaffUsers }));
vi.mock('@/lib/seat-limits', () => ({ countBillableStaff: mockCountBillableStaff }));
vi.mock('@/components/dashboard/staff/StaffListClient', () => ({
  default: ({
    currentWorkerCount,
    pendingInviteCount,
  }: {
    currentWorkerCount: number;
    pendingInviteCount: number;
  }) => (
    <div
      data-testid="staff-list"
      data-workers={currentWorkerCount}
      data-pending={pendingInviteCount}
    />
  ),
}));

import StaffPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({
    organizationId: 'org-1',
    role: 'owner',
    accessibleFacilities: [],
    organizationUserId: 'ou-1',
    userId: 'u-1',
  });
  mockGetStaffUsers.mockResolvedValue([]);
  prismaMock.subscription.findUnique.mockResolvedValue({ plan: 'starter', status: 'active' });
  prismaMock.invite.count.mockResolvedValue(0);
  mockCountBillableStaff.mockResolvedValue(7);
});

describe('StaffPage — seat count', () => {
  it('uses the canonical billable-staff count rather than its own query', async () => {
    render(await StaffPage());

    // The helper is the single definition of "who consumes a seat"; the page
    // used to re-implement it and lose the `active` filter.
    expect(mockCountBillableStaff).toHaveBeenCalledWith('org-1');
    expect(screen.getByTestId('staff-list')).toHaveAttribute('data-workers', '7');
  });

  it('reflects a freed seat once a member is deactivated', async () => {
    // What removal does: the membership goes inactive, so the helper returns one
    // fewer. Previously the page's own count ignored `active` and stayed put,
    // which is what blocked re-inviting at the cap.
    mockCountBillableStaff.mockResolvedValue(6);

    render(await StaffPage());

    expect(screen.getByTestId('staff-list')).toHaveAttribute('data-workers', '6');
  });

  it('still counts live pending invites separately', async () => {
    prismaMock.invite.count.mockResolvedValue(2);

    render(await StaffPage());

    expect(screen.getByTestId('staff-list')).toHaveAttribute('data-pending', '2');
  });
});
