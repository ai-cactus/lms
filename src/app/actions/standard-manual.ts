'use server';

import { PrismaClient } from '@prisma/client';
import { auth } from '@/auth';

const prisma = new PrismaClient();

export async function getActiveStandardManual() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  return prisma.standardManual.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getStandardManualHistory() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  // Must be an admin to see history usually, but let's just protect the call
  if (session.user.role !== 'admin') throw new Error('Forbidden');

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
