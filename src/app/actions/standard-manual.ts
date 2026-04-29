'use server';

import { PrismaClient } from '@prisma/client';
import { auth } from '@/auth';
import { checkSystemAuth } from '@/app/actions/system-admin';

const prisma = new PrismaClient();

export async function getActiveStandardManual() {
  const isSystemAdmin = await checkSystemAuth();
  const session = await auth();
  if (!session?.user && !isSystemAdmin) throw new Error('Unauthorized');

  return prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getStandardManualHistory() {
  const isSystemAdmin = await checkSystemAuth();
  const session = await auth();

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
