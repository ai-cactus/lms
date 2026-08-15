/**
 * Unit tests for listFacilityCards() — the query behind the Profile Settings
 * facility card list ("My Facilities" for org-wide roles, "Assigned Facilities"
 * for a supervisor).
 *
 * Priorities: the organizationId filter is unconditional (tenancy is
 * structural, not optional), the assigned-membership narrowing only applies
 * when explicitly requested, and the nested supervisor read resolves to null
 * rather than throwing when a facility has none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFacilityFindMany } = vi.hoisted(() => ({
  mockFacilityFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { facility: { findMany: mockFacilityFindMany } },
}));

import { listFacilityCards } from './facility-cards';

beforeEach(() => {
  vi.clearAllMocks();
  mockFacilityFindMany.mockResolvedValue([]);
});

describe('listFacilityCards', () => {
  it('scopes the query to the given organization unconditionally', async () => {
    await listFacilityCards({ organizationId: 'org-1' });

    const args = mockFacilityFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ organizationId: 'org-1' });
  });

  it('narrows to the caller-active membership when assignedToOrganizationUserId is given', async () => {
    await listFacilityCards({ organizationId: 'org-1', assignedToOrganizationUserId: 'ou-1' });

    const args = mockFacilityFindMany.mock.calls[0][0];
    expect(args.where).toEqual({
      organizationId: 'org-1',
      userFacilities: { some: { organizationUserId: 'ou-1', active: true } },
    });
  });

  it('omits the membership narrowing for an org-wide role (null/undefined id)', async () => {
    await listFacilityCards({ organizationId: 'org-1', assignedToOrganizationUserId: null });

    const args = mockFacilityFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ organizationId: 'org-1' });
  });

  it('maps a facility with a resolved supervisor', async () => {
    mockFacilityFindMany.mockResolvedValue([
      {
        id: 'fac-1',
        name: 'Alpha Site',
        type: 'clinic',
        address: '123 Main St',
        userFacilities: [
          {
            organizationUser: {
              user: { fullName: 'Ada Lovelace', email: 'ada@acme.com' },
            },
          },
        ],
      },
    ]);

    const [card] = await listFacilityCards({ organizationId: 'org-1' });

    expect(card).toEqual({
      id: 'fac-1',
      name: 'Alpha Site',
      type: 'clinic',
      address: '123 Main St',
      supervisorName: 'Ada Lovelace',
      supervisorEmail: 'ada@acme.com',
    });
  });

  it('falls back to null supervisor fields when the facility has no active supervisor', async () => {
    mockFacilityFindMany.mockResolvedValue([
      { id: 'fac-2', name: 'Beta Site', type: null, address: null, userFacilities: [] },
    ]);

    const [card] = await listFacilityCards({ organizationId: 'org-1' });

    expect(card.supervisorName).toBeNull();
    expect(card.supervisorEmail).toBeNull();
  });

  it('falls back to null supervisorName when the supervisor has no fullName set', async () => {
    mockFacilityFindMany.mockResolvedValue([
      {
        id: 'fac-3',
        name: 'Gamma Site',
        type: null,
        address: null,
        userFacilities: [
          { organizationUser: { user: { fullName: '', email: 'nameless@acme.com' } } },
        ],
      },
    ]);

    const [card] = await listFacilityCards({ organizationId: 'org-1' });

    expect(card.supervisorName).toBeNull();
    expect(card.supervisorEmail).toBe('nameless@acme.com');
  });
});
