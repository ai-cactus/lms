'use server';

import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createMembership } from '@/lib/auth/membership';
import { seedDefaultDocumentCategories } from '@/lib/documents/document-categories';

const createOrgSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters'),
});

export type State = {
  error?: string;
  success?: boolean;
};

export async function createOrganization(prevState: State, formData: FormData): Promise<State> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'Not authenticated' };
  }

  // One organisation per user — a user already in an org cannot create another.
  const existingMembership = await prisma.organizationUser.findFirst({
    where: { userId: session.user.id, active: true },
    select: { id: true },
  });
  if (existingMembership) {
    return { error: 'You already belong to an organization and cannot create another.' };
  }

  const validatedFields = createOrgSchema.safeParse({
    name: formData.get('name'),
  });

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors.name?.[0] || 'Invalid input' };
  }

  const { name } = validatedFields.data;
  const slug =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-') +
    '-' +
    Math.random().toString(36).substring(2, 7);

  try {
    const { orgId, facilityId } = await prisma.$transaction(async (tx) => {
      const existingOrg = await tx.organization.findFirst({
        where: {
          name: {
            equals: name,
            mode: 'insensitive',
          },
        },
      });

      if (existingOrg) {
        throw new Error(
          'Organization with this name already exists. Please contact your admin for access.',
        );
      }

      const org = await tx.organization.create({
        data: { name, slug },
      });

      // Every organisation starts with one facility; the founder is attached to it.
      const facility = await tx.facility.create({
        data: {
          organizationId: org.id,
          name,
        },
      });

      await seedDefaultDocumentCategories(org.id, tx);

      return { orgId: org.id, facilityId: facility.id };
    });

    // The founder of a new organisation becomes its `owner`.
    await createMembership({
      userId: session.user.id,
      organizationId: orgId,
      facilityId,
      role: 'owner',
    });
  } catch (error) {
    logger.error({ msg: 'Failed to create organization:', err: error });
    return { error: 'Failed to create organization. Please try again.' };
  }

  // Redirect must be outside try/catch in Next.js server actions
  redirect('/dashboard');
}
