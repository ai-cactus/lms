'use server';

import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { MAX_DOCUMENT_CATEGORY_LENGTH } from '@/lib/documents/document-categories';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';

/**
 * Every category name defined by the caller's organization, alphabetically.
 *
 * Org-scoped like the rest of the Document Hub: a member granted
 * `document.read` sees their organization's vocabulary and nothing else. An
 * unauthorized caller gets an empty list rather than an error, mirroring
 * `getDocuments()`.
 */
export async function getDocumentCategories(): Promise<string[]> {
  const session = await auth();
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    !can(dbRoleToRoleKey(session.user.role), 'document.read')
  ) {
    return [];
  }

  const categories = await prisma.documentCategory.findMany({
    where: { organizationId: session.user.organizationId },
    select: { name: true },
    orderBy: { name: 'asc' },
  });

  return categories.map((category) => category.name);
}

/**
 * Add a category to the caller's organization from the upload modal.
 *
 * Returns the stored name so the caller can select it immediately — on a
 * case-insensitive collision that is the EXISTING spelling, which keeps the
 * upload flow moving instead of dead-ending on a duplicate error.
 */
export async function createDocumentCategory(
  name: string,
): Promise<{ name?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return { error: 'Not authenticated or not in an organization' };
  }

  const { id: userId, organizationId } = session.user;

  if (!can(dbRoleToRoleKey(session.user.role), 'document.create')) {
    logger.warn({
      msg: '[doc] Category creation denied — missing document.create',
      userId,
      role: session.user.role,
    });
    return { error: 'You do not have permission to add categories.' };
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return { error: 'Category name is required.' };
  }
  if (trimmed.length > MAX_DOCUMENT_CATEGORY_LENGTH) {
    return {
      error: `Category name is too long (max ${MAX_DOCUMENT_CATEGORY_LENGTH} characters).`,
    };
  }

  const existing = await prisma.documentCategory.findFirst({
    where: { organizationId, name: { equals: trimmed, mode: 'insensitive' } },
    select: { name: true },
  });

  if (existing) {
    return { name: existing.name };
  }

  let created: { id: string; name: string };
  try {
    created = await prisma.documentCategory.create({
      data: { organizationId, name: trimmed },
      select: { id: true, name: true },
    });
  } catch (err) {
    // Two members naming the same category at once: the unique index is the
    // authority, and the loser should still land on a usable category.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { name: trimmed };
    }
    throw err;
  }

  logger.info({
    msg: '[doc] Document category created',
    userId,
    organizationId,
    categoryId: created.id,
  });

  await audit({
    action: 'document.category.create',
    actorId: userId,
    actorRole: session.user.role,
    organizationId,
    targetType: 'document_category',
    targetId: created.id,
    metadata: { name: created.name },
    ...getClientContext(await headers()),
  });

  revalidatePath('/dashboard/documents');
  return { name: created.name };
}
