import React from 'react';
import ProfileForm from '@/components/dashboard/ProfileForm';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getSignedUrl } from '@/lib/storage';

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

  console.log('ProfilePage Session:', session?.user?.id);
  console.log('ProfilePage Profile:', profile);
  console.log('ProfilePage User:', user);

  let avatarDisplayUrl: string | null = null;
  if (profile?.avatarUrl) {
    try {
      avatarDisplayUrl = await getSignedUrl(profile.avatarUrl);
    } catch (error) {
      console.error('Failed to get signed URL for avatar:', error);
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
        licenseNumber: user.organization.licenseNumber,
        isHipaaCompliant: user.organization.isHipaaCompliant,
        primaryBusinessType: user.organization.primaryBusinessType,
        additionalBusinessTypes: user.organization.additionalBusinessTypes || [],
        programServices: user.organization.programServices || [],
      }
    : null;

  return <ProfileForm initialData={initialData} organizationData={organizationData} />;
}
