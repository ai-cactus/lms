import React from 'react';
import ProfileForm from '@/components/dashboard/ProfileForm';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getSignedUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import type { Role } from '@/types/next-auth';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  // Fetch profile
  const profile = await prisma.profile.findUnique({
    where: { id: session.user.id },
  });

  // Fetch user with organization + facility
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { organization: true, facility: true },
  });

  const role = (user?.role || 'worker') as Role;
  const roleKey = dbRoleToRoleKey(role);
  const canReadFacility = can(roleKey, 'facility.read');
  const canEditFacility = can(roleKey, 'facility.edit');

  logger.info({ msg: 'ProfilePage Session:', data: session?.user?.id });
  logger.info({ msg: 'ProfilePage Profile:', data: profile });
  logger.info({ msg: 'ProfilePage User:', data: user });

  let avatarDisplayUrl: string | null = null;
  if (profile?.avatarUrl) {
    try {
      avatarDisplayUrl = await getSignedUrl(profile.avatarUrl);
    } catch (error) {
      logger.error({ msg: 'Failed to get signed URL for avatar:', err: error });
    }
  }

  // Construct initial profile data
  const initialData = {
    id: session.user.id!,
    first_name: profile?.firstName || '',
    last_name: profile?.lastName || '',
    email: user?.email || session.user.email || '',
    role,
    company_name: profile?.companyName || '',
    jobTitle: profile?.jobTitle || '',
    avatarUrl: profile?.avatarUrl || null,
    avatarDisplayUrl,
    authProvider: user?.authProvider || 'credentials',
  };

  // Organization data — org-level fields only.
  const organizationData = user?.organization
    ? {
        id: user.organization.id,
        name: user.organization.name,
        dba: user.organization.dba,
        ein: user.organization.ein,
        primaryContact: user.organization.primaryContact,
        primaryEmail: user.organization.primaryEmail,
        isHipaaCompliant: user.organization.isHipaaCompliant,
        primaryBusinessType: user.organization.primaryBusinessType,
        additionalBusinessTypes: user.organization.additionalBusinessTypes || [],
      }
    : null;

  // Facility data — location/compliance fields now live on the facility.
  const facility = user?.facility;
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
      canEditFacility={canEditFacility}
    />
  );
}
