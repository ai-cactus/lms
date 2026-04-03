import React from 'react';
import { auth } from '@/auth.worker';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getSignedUrl } from '@/lib/storage';
import WorkerProfileForm from '@/components/worker/WorkerProfileForm';

export default async function WorkerProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  // Fetch user with profile and organization
  console.log('[WorkerProfilePage] Rendering for user:', session.user.id);
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      profile: true,
      organization: true,
    },
  });

  if (!user) {
    redirect('/login');
  }

  let avatarDisplayUrl: string | null = null;
  if (user.profile?.avatarUrl) {
    try {
      avatarDisplayUrl = await getSignedUrl(user.profile.avatarUrl);
    } catch (error) {
      console.error('Failed to get signed URL for avatar:', error);
    }
  }

  const userData = {
    id: user.id,
    first_name: user.profile?.firstName || '',
    last_name: user.profile?.lastName || '',
    jobTitle: user.profile?.jobTitle || '',
    email: user.email,
    role: user.role,
    avatarUrl: user.profile?.avatarUrl,
    avatarDisplayUrl,
  };

  const organizationData = user.organization
    ? {
        name: user.organization.name,
        address: user.organization.address,
        city: user.organization.city,
        state: user.organization.state,
        zipCode: user.organization.zipCode,
      }
    : null;

  return <WorkerProfileForm user={userData} organization={organizationData} />;
}
