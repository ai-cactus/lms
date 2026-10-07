import React from 'react';
import { auth } from '@/auth.worker';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { signAvatarUrl } from '@/lib/storage/avatar';
import WorkerProfileForm from '@/components/worker/WorkerProfileForm';
import { logger } from '@/lib/logger';

export default async function WorkerProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  logger.info({ msg: '[WorkerProfilePage] Rendering for user:', data: session.user.id });
  const { organizationUserId } = session.user;

  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    organizationUserId
      ? prisma.organizationUser.findUnique({
          where: { id: organizationUserId },
          select: {
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

  if (!user) {
    redirect('/login');
  }

  // BUG-65: only the signed display URL is sent; the stored storage URI names
  // the bucket and object key and must never reach the browser.
  const avatarDisplayUrl = await signAvatarUrl(user.avatarUrl, user.id);

  const userData = {
    id: user.id,
    first_name: user.firstName || '',
    last_name: user.lastName || '',
    email: user.email,
    role: session.user.role,
    avatarDisplayUrl,
    authProvider: user.authProvider,
  };

  // Name is org-level; location fields now live on the facility.
  const facility = membership?.facilities[0]?.facility;
  const organizationData = membership?.organization
    ? {
        name: membership.organization.name,
        address: facility?.address ?? null,
        city: facility?.city ?? null,
        state: facility?.state ?? null,
        zipCode: facility?.zipCode ?? null,
      }
    : null;

  return <WorkerProfileForm user={userData} organization={organizationData} />;
}
