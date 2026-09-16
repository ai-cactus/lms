'use server';

import prisma from '@/lib/prisma';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { logger } from '@/lib/logger';
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
    if (!session?.user?.id) throw new Error('Unauthorized');
    // `isAdminRole` is role-shaped and admits Finance and Supervisor while
    // ignoring the `standardManual.*` permissions the registry already defines.
    // The registry is the boundary: only roles granted `standardManual.read`
    // may list the accreditation manuals behind the RAG knowledge base.
    if (!can(dbRoleToRoleKey(session.user.role), 'standardManual.read')) {
      logger.warn({
        msg: '[standardManual] History read denied — missing standardManual.read',
        userId: session.user.id,
        role: session.user.role,
      });
      throw new Error('Forbidden');
    }
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
