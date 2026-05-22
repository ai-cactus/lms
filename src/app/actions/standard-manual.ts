'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { verifySystemAdminCookie } from '@/lib/system-auth';

export async function getActiveStandardManual() {
  const [isSystemAdmin, session] = await Promise.all([verifySystemAdminCookie(), auth()]);

  if (!isSystemAdmin && !session?.user) {
    throw new Error('Unauthorized');
  }

  return prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getStandardManualHistory() {
  const [isSystemAdmin, session] = await Promise.all([verifySystemAdminCookie(), auth()]);

  if (!isSystemAdmin) {
    if (!session?.user) throw new Error('Unauthorized');
    if (session.user.role !== 'admin') throw new Error('Forbidden');
  }

  return prisma.standardManual.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      filename: true,
      version: true,
      isActive: true,
      processedAt: true,
      chunkCount: true,
      createdAt: true,
      uploadedBy: true,
    },
  });
}
