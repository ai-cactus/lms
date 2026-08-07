import ProfileForm from '@/components/dashboard/ProfileForm';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getSignedUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  const { organizationUserId } = session.user;

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
              take: 1,
              select: { facility: true },
            },
          },
        })
      : null,
  ]);

  const role = session.user.role;
  const roleKey = dbRoleToRoleKey(role);
  const canReadFacility = can(roleKey, 'facility.read');

  logger.info({ msg: 'ProfilePage Session:', data: session?.user?.id });
  logger.info({ msg: 'ProfilePage User:', data: { userId: user?.id } });

  let avatarDisplayUrl: string | null = null;
  if (user?.avatarUrl) {
    try {
      avatarDisplayUrl = await getSignedUrl(user.avatarUrl);
    } catch (error) {
      logger.error({ msg: 'Failed to get signed URL for avatar:', err: error });
    }
  }

  const initialData = {
    id: session.user.id!,
    first_name: user?.firstName || '',
    last_name: user?.lastName || '',
    email: user?.email || session.user.email || '',
    role,
    jobTitle: membership?.jobTitle || '',
    avatarUrl: user?.avatarUrl || null,
    avatarDisplayUrl,
    authProvider: user?.authProvider || 'credentials',
  };

  // Organization data — org-level fields only.
  const organization = membership?.organization;
  const organizationData = organization
    ? {
        id: organization.id,
        name: organization.name,
        dba: organization.dba,
        ein: organization.ein,
        primaryContact: organization.primaryContact,
        primaryEmail: organization.primaryEmail,
        isHipaaCompliant: organization.isHipaaCompliant,
        primaryBusinessType: organization.primaryBusinessType,
        additionalBusinessTypes: organization.additionalBusinessTypes || [],
      }
    : null;

  // Facility data — location/compliance fields now live on the facility.
  const facility = membership?.facilities[0]?.facility;
  const facilityData = facility
    ? {
        id: facility.id,
        name: facility.name,
        staffCount: facility.staffCount,
        phone: facility.phone,
        address: facility.address,
        city: facility.city,
        country: facility.country,
        state: facility.state,
        zipCode: facility.zipCode,
        timezone: facility.timezone,
        licenseNumber: facility.licenseNumber,
        programServices: facility.programServices || [],
        complianceDocumentUrl: facility.complianceDocumentUrl,
        complianceDocumentName: facility.complianceDocumentName,
        complianceDocumentDisplayUrl: facility.complianceDocumentUrl
          ? await getSignedUrl(facility.complianceDocumentUrl).catch(() => null)
          : null,
      }
    : null;

  return (
    <ProfileForm
      initialData={initialData}
      organizationData={organizationData}
      facilityData={facilityData}
      canReadFacility={canReadFacility}
    />
  );
}
