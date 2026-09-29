/**
 * Seat counting counts ACTIVE memberships only. That single predicate is what
 * frees a seat when staff are removed and when a user is deleted (Q-23): the
 * soft delete deactivates every membership but keeps the rows, so a count that
 * lost `active: true` would keep charging for deleted people.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {}, default: {} }));

import { countBillableSeats, countBillableStaff } from './seat-limits';

type SeatClient = NonNullable<NonNullable<Parameters<typeof countBillableSeats>[1]>['client']>;

function fakeClient(activeMembers: number, pendingInvites: number) {
  const organizationUser = { count: vi.fn().mockResolvedValue(activeMembers) };
  const invite = { count: vi.fn().mockResolvedValue(pendingInvites) };
  const client = { organizationUser, invite, organization: {} } as unknown as SeatClient;
  return { client, organizationUser, invite };
}

describe('countBillableSeats', () => {
  it('counts only active memberships of the organization', async () => {
    const { client, organizationUser, invite } = fakeClient(4, 0);

    const seats = await countBillableSeats('org-1', { client });

    expect(seats).toEqual({ activeMembers: 4, pendingInvites: 0 });
    expect(organizationUser.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', active: true },
    });
    expect(invite.count).not.toHaveBeenCalled();
  });

  it('adds unexpired pending invites when asked', async () => {
    const { client, invite } = fakeClient(4, 2);

    const total = await countBillableStaff('org-1', { includePendingInvites: true, client });

    expect(total).toBe(6);
    expect(invite.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', status: 'pending', expiresAt: { gt: expect.any(Date) } },
    });
  });
});
