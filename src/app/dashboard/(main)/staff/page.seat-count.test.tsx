/**
 * Removing a staff member did not free their seat.
 *
 * `removeStaff` DEACTIVATES a membership (`active: false`) rather than deleting
 * it, so the person's training record survives — and the canonical
 * `countBillableSeats` filters on `active: true` accordingly. This page,
 * however, hand-rolled its own copy of that count and had drifted from it: no
 * `active` filter, so removed staff kept consuming seats. The gauge never went
 * down and an org sitting at its plan cap could not invite anyone again even
 * with room on the roster (staging QA 2026-09-04).
 *
 * Both figures — members and outstanding invites — now come from the shared
 * helper, so neither can drift from the gate that enforces the limit.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockRequirePermission, mockGetStaffUsers, mockCountBillableSeats } = vi.hoisted(
  () => ({
    prismaMock: {
      subscription: { findUnique: vi.fn() },
    },
    mockRequirePermission: vi.fn(),
    mockGetStaffUsers: vi.fn(),
    mockCountBillableSeats: vi.fn(),
  }),
);

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/rbac/require-permission', () => ({
  requirePermissionWithFacilityScope: mockRequirePermission,
  requirePermission: mockRequirePermission,
}));
vi.mock('@/app/actions/user', () => ({ getStaffUsers: mockGetStaffUsers }));
vi.mock('@/lib/seat-limits', () => ({ countBillableSeats: mockCountBillableSeats }));
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
  mockCountBillableSeats.mockResolvedValue({ activeMembers: 7, pendingInvites: 0 });
});

describe('StaffPage — seat count', () => {
  it('uses the canonical billable-staff count rather than its own query', async () => {
    render(await StaffPage());

    // The helper is the single definition of "who consumes a seat"; the page
    // used to re-implement it and lose the `active` filter.
    expect(mockCountBillableSeats).toHaveBeenCalledWith('org-1', { includePendingInvites: true });
    expect(screen.getByTestId('staff-list')).toHaveAttribute('data-workers', '7');
  });

  it('reflects a freed seat once a member is deactivated', async () => {
    // What removal does: the membership goes inactive, so the helper returns one
    // fewer. Previously the page's own count ignored `active` and stayed put,
    // which is what blocked re-inviting at the cap.
    mockCountBillableSeats.mockResolvedValue({ activeMembers: 6, pendingInvites: 0 });

    render(await StaffPage());

    expect(screen.getByTestId('staff-list')).toHaveAttribute('data-workers', '6');
  });

  it('still counts live pending invites separately', async () => {
    mockCountBillableSeats.mockResolvedValue({ activeMembers: 7, pendingInvites: 2 });

    render(await StaffPage());

    expect(screen.getByTestId('staff-list')).toHaveAttribute('data-pending', '2');
  });
});

/**
 * Founder ruling Q26 (docs/local/RBAC-founder-answers-2026-09-15.md): a module a
 * role cannot access is hidden from the nav AND answers a typed URL with "Page
 * not found". The roster took `requirePermission`'s default `onDeny: 'redirect'`
 * until this change, and a bounce to /dashboard still confirms a roster exists.
 */
describe('StaffPage — Q26 uniform deny', () => {
  it('asks the guard for notFound, not the default redirect', async () => {
    await StaffPage();

    // The options object is the whole assertion: `user.read` alone still passes
    // if the third argument is dropped, and the deny shape silently reverts.
    expect(mockRequirePermission).toHaveBeenCalledWith('user.read', undefined, {
      onDeny: 'notFound',
    });
  });

  it('propagates the guard refusal without reading the roster', async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));

    await expect(StaffPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockGetStaffUsers).not.toHaveBeenCalled();
    expect(mockCountBillableSeats).not.toHaveBeenCalled();
  });
});
