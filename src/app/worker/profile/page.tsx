import React from 'react';
import { auth } from '@/auth.worker';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { getSignedUrl } from '@/lib/storage';
import WorkerProfileForm from '@/components/worker/WorkerProfileForm';
import { logger } from '@/lib/logger';

export default async function WorkerProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  logger.info({ msg: '[WorkerProfilePage] Rendering for user:', data: session.user.id });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      profile: true,
      organization: true,
      facility: true,
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
      logger.error({ msg: 'Failed to get signed URL for avatar:', err: error });
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
    authProvider: user.authProvider,
  };

  // Name is org-level; location fields now live on the facility.
  const organizationData = user.organization
    ? {
        name: user.organization.name,
        address: user.facility?.address ?? null,
        city: user.facility?.city ?? null,
        state: user.facility?.state ?? null,
        zipCode: user.facility?.zipCode ?? null,
      }
    : null;

  return <WorkerProfileForm user={userData} organization={organizationData} />;
}
