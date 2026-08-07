import crypto from 'crypto';
import prisma from '@/lib/prisma';

export const SYSTEM_USER_EMAIL = 'system@theraptly.internal';
const SYSTEM_ORG_SLUG = 'system';
const SYSTEM_ORG_NAME = 'System';

/**
 * Idempotently returns the `OrganizationUser` membership for the platform's
 * internal "System" identity, which authors all global (`isGlobal`) video
 * courses. `Course.creator` is now an `OrganizationUser` (not a bare `User`),
 * so the system identity needs a home organization — a dedicated internal
 * organization it exclusively occupies, created once alongside it.
 */
export async function getOrCreateSystemUser() {
  const user = await prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {},
    create: {
      email: SYSTEM_USER_EMAIL,
      // Never logs in: a random non-bcrypt string can never match bcrypt.compare.
      password: crypto.randomBytes(32).toString('hex'),
      emailVerified: true,
    },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: SYSTEM_ORG_SLUG },
    update: {},
    create: { name: SYSTEM_ORG_NAME, slug: SYSTEM_ORG_SLUG },
  });

  return prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
    update: {},
    // Internal platform membership. No facility row: this membership authors
    // global courses and never carries facility scope.
    create: { userId: user.id, organizationId: organization.id, role: 'admin' },
  });
}
