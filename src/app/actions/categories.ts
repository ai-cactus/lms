'use server';

import { PrismaClient } from '@prisma/client';
import { auth } from '@/auth';
import { SYSTEM_CATEGORIES } from '@/lib/course-categories';

const prisma = new PrismaClient();

export async function getCategories() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const orgId = session.user.organizationId;

  // 1. Ensure system categories exist in the DB (basic seeding strategy)
  // Usually this is done via a seed script, but doing it here guarantees they are present.
  const existingSystemCategories = await prisma.courseCategory.count({
    where: { isSystem: true },
  });

  if (existingSystemCategories === 0) {
    await prisma.courseCategory.createMany({
      data: SYSTEM_CATEGORIES.map((c) => ({
        name: c.name,
        slug: c.slug,
        description: c.description,
        isSystem: true,
        organizationId: null,
      })),
      skipDuplicates: true,
    });
  }

  // 2. Fetch system categories + custom categories for this org
  const categories = await prisma.courseCategory.findMany({
    where: {
      OR: [{ isSystem: true }, { organizationId: orgId }],
    },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });

  return categories;
}

export async function createCustomCategory(name: string, description?: string) {
  const session = await auth();
  if (!session?.user?.organizationId) throw new Error('Unauthorized or no organization');

  if (!name.trim()) throw new Error('Category name is required');

  const slug =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-4);

  const newCategory = await prisma.courseCategory.create({
    data: {
      name,
      slug,
      description,
      isSystem: false,
      organizationId: session.user.organizationId,
    },
  });

  return newCategory;
}
