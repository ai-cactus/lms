/**
 * Soft-deleted organizations (`Organization.deletedAt`), for the paths the
 * membership choke point does not reach.
 *
 * Session-scoped code needs nothing from here: deleting an organization
 * deactivates every active membership in it, and the membership lookups in
 * `src/lib/auth/membership.ts` also require a live organization, so every
 * session, roster and `active: true` audience drops the org on its own. What is
 * left are the cross-tenant background jobs that read rows by organization
 * without going through a membership — they filter explicitly with these.
 *
 * Deliberately NOT a Prisma extension filter: the GCS sweepers must keep seeing
 * a deleted organization's files as referenced, or a restorable org's videos
 * and avatars would be purged as orphans.
 */
import prisma from '@/lib/prisma';

/** `where` fragment for an organization that has not been soft-deleted. */
export const liveOrganizationWhere = { deletedAt: null } as const;

/** Ids of every soft-deleted organization. A short list: deletes are rare, manual and audited. */
export async function getDeletedOrganizationIds(): Promise<string[]> {
  const rows = await prisma.organization.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * `where` fragment that drops rows belonging to the given organizations while
 * KEEPING rows with no organization — a bare `notIn` would silently drop those
 * too, because SQL `NULL NOT IN (…)` is not true.
 */
export function excludeDeletedOrgIds(organizationIds: readonly string[]) {
  if (organizationIds.length === 0) return {};
  return {
    OR: [{ organizationId: null }, { organizationId: { notIn: [...organizationIds] } }],
  };
}
