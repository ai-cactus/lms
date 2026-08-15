import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getSignedUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey, getRoleDisplayName } from '@/lib/rbac/role-utils';
import { isOrgWideFacilityRole } from '@/lib/facility/scope';
import { listFacilityCards } from '@/lib/facility/facility-cards';
import ProfileSettings from '@/components/dashboard/profile/ProfileSettings';
import type {
  ComplianceDocument,
  FacilitiesMode,
  OrganizationSectionData,
} from '@/components/dashboard/profile/types';

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  const { organizationUserId, role } = session.user;
  const roleKey = dbRoleToRoleKey(role);

  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    organizationUserId
      ? prisma.organizationUser.findUnique({
          where: { id: organizationUserId },
          select: {
            jobTitle: true,
            organization: true,
            facilities: {
              where: { active: true },
              orderBy: { joinedAt: 'asc' },
              take: 1,
              select: { facility: true },
            },
          },
        })
      : null,
  ]);

  let avatarDisplayUrl: string | null = null;
  if (user?.avatarUrl) {
    try {
      avatarDisplayUrl = await getSignedUrl(user.avatarUrl);
    } catch (error) {
      logger.error({
        msg: '[user] Failed to sign avatar URL for profile',
        userId: session.user.id,
        err: error,
      });
    }
  }

  const profile = {
    id: session.user.id!,
    first_name: user?.firstName || '',
    last_name: user?.lastName || '',
    email: user?.email || session.user.email || '',
    role,
    roleDisplayName: getRoleDisplayName(role),
    jobTitle: membership?.jobTitle || '',
    avatarUrl: user?.avatarUrl || null,
    avatarDisplayUrl,
    authProvider: user?.authProvider || 'credentials',
  };

  // Location, credentialing and services moved off Organization onto the
  // member's Facility, so the panel reads both and `updateOrganization` routes
  // each half back to the table that owns it.
  const org = membership?.organization;
  const facility = membership?.facilities[0]?.facility;
  const organization: OrganizationSectionData | null = org
    ? {
        id: org.id,
        name: org.name,
        dba: org.dba,
        ein: org.ein,
        primaryContact: org.primaryContact,
        primaryEmail: org.primaryEmail,
        isHipaaCompliant: org.isHipaaCompliant,
        primaryBusinessType: org.primaryBusinessType,
        additionalBusinessTypes: org.additionalBusinessTypes ?? [],
        staffCount: facility?.staffCount ?? null,
        phone: facility?.phone ?? null,
        address: facility?.address ?? null,
        city: facility?.city ?? null,
        state: facility?.state ?? null,
        country: facility?.country ?? null,
        zipCode: facility?.zipCode ?? null,
        licenseNumber: facility?.licenseNumber ?? null,
        programServices: facility?.programServices ?? [],
      }
    : null;

  // An org-wide seat sees every facility under the organization; a facility-bound
  // one (supervisor) sees only the sites on their own active assignments.
  const isOrgWide = isOrgWideFacilityRole(role);
  const canReadFacility = can(roleKey, 'facility.read');
  const facilitiesMode: FacilitiesMode = !canReadFacility
    ? 'none'
    : isOrgWide
      ? 'organization'
      : 'assigned';

  const facilities =
    facilitiesMode !== 'none' && org
      ? await listFacilityCards({
          organizationId: org.id,
          assignedToOrganizationUserId: isOrgWide ? null : organizationUserId,
        })
      : [];

  const complianceDocuments: ComplianceDocument[] = facility
    ? await Promise.all(
        (
          await prisma.facilityDocument.findMany({
            where: { facilityId: facility.id },
            select: { id: true, name: true, sizeBytes: true, mimeType: true, url: true },
            orderBy: { createdAt: 'asc' },
          })
        ).map(async (document) => ({
          id: document.id,
          name: document.name,
          sizeBytes: document.sizeBytes,
          mimeType: document.mimeType,
          // A file that cannot be signed still lists — the row simply loses its
          // link rather than the whole panel failing.
          displayUrl: await getSignedUrl(document.url).catch(() => null),
        })),
      )
    : [];

  return (
    <ProfileSettings
      profile={profile}
      organization={organization}
      complianceDocuments={complianceDocuments}
      facilities={facilities}
      showOrganization={isOrgWide && can(roleKey, 'organization.read')}
      canEditOrganization={can(roleKey, 'organization.edit')}
      facilitiesMode={facilitiesMode}
    />
  );
}
