/**
 * The facility roster rendered as cards on Profile Settings (My Facilities for
 * org-wide roles, Assigned Facilities for a supervisor).
 *
 * Each card names its facility's supervisor, so the supervisor is fetched as a
 * nested read rather than a follow-up query per card.
 */
import prisma from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';

export interface FacilityCard {
  id: string;
  name: string;
  type: string | null;
  address: string | null;
  supervisorName: string | null;
  supervisorEmail: string | null;
}

interface ListFacilityCardsOptions {
  organizationId: string;
  /**
   * Narrow the list to the facilities this membership actively holds. Omit for
   * an org-wide role, which sees every facility under the organization.
   */
  assignedToOrganizationUserId?: string | null;
}

export async function listFacilityCards({
  organizationId,
  assignedToOrganizationUserId,
}: ListFacilityCardsOptions): Promise<FacilityCard[]> {
  // Tenancy is structural: the org filter is applied unconditionally, so a
  // facility from another tenant can never enter the result set.
  const where: Prisma.FacilityWhereInput = { organizationId };

  if (assignedToOrganizationUserId) {
    where.userFacilities = {
      some: { organizationUserId: assignedToOrganizationUserId, active: true },
    };
  }

  const facilities = await prisma.facility.findMany({
    where,
    select: {
      id: true,
      name: true,
      type: true,
      address: true,
      userFacilities: {
        where: { active: true, organizationUser: { active: true, role: 'supervisor' } },
        select: {
          organizationUser: { select: { user: { select: { fullName: true, email: true } } } },
        },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return facilities.map((facility) => {
    const supervisor = facility.userFacilities[0]?.organizationUser.user ?? null;
    return {
      id: facility.id,
      name: facility.name,
      type: facility.type,
      address: facility.address,
      supervisorName: supervisor?.fullName || null,
      supervisorEmail: supervisor?.email ?? null,
    };
  });
}
