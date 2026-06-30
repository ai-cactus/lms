import React from 'react';
import ProfileForm from '@/components/dashboard/ProfileForm';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getSignedUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  // Fetch profile
  const profile = await prisma.profile.findUnique({
    where: { id: session.user.id },
  });

  // Fetch user with organization
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { organization: true },
  });

  const role = user?.role || 'worker';

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
    role: role as 'admin' | 'worker',
    company_name: profile?.companyName || '',
    jobTitle: profile?.jobTitle || '',
    avatarUrl: profile?.avatarUrl || null,
    avatarDisplayUrl,
    authProvider: user?.authProvider || 'credentials',
  };

  // Construct organization data
  const organizationData = user?.organization
    ? {
        id: user.organization.id,
        name: user.organization.name,
        dba: user.organization.dba,
        ein: user.organization.ein,
        staffCount: user.organization.staffCount,
        primaryContact: user.organization.primaryContact,
        primaryEmail: user.organization.primaryEmail,
        phone: user.organization.phone,
        address: user.organization.address,
        city: user.organization.city,
        country: user.organization.country,
        state: user.organization.state,
        zipCode: user.organization.zipCode,
        timezone: user.organization.timezone,
        licenseNumber: user.organization.licenseNumber,
        isHipaaCompliant: user.organization.isHipaaCompliant,
        primaryBusinessType: user.organization.primaryBusinessType,
        additionalBusinessTypes: user.organization.additionalBusinessTypes || [],
        programServices: user.organization.programServices || [],
        complianceDocumentUrl: user.organization.complianceDocumentUrl,
        complianceDocumentName: user.organization.complianceDocumentName,
        complianceDocumentDisplayUrl: user.organization.complianceDocumentUrl
          ? await getSignedUrl(user.organization.complianceDocumentUrl).catch(() => null)
          : null,
      }
    : null;

  return <ProfileForm initialData={initialData} organizationData={organizationData} />;
}
