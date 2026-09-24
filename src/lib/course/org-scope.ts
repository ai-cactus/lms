/**
 * "Which courses belong to this organisation" — the single definition.
 *
 * A course written in-house carries the org on `Course.organizationId` (Q25),
 * while a course taken from the platform catalogue belongs to ANOTHER tenant and
 * is tied here only through an `OrgCourseOffering` row. A query that spells out
 * only the first half — as every audit-report query did — silently drops every
 * adopted course, which for a video-only customer means an empty catalogue.
 *
 * ⛔ Deliberately carries NO `archivedAt` filter. Archived rows are excluded by
 * the client extension in `db/index.ts`, which the auditor export deliberately
 * bypasses — and it builds its queries from this predicate. Baking the filter in
 * here would re-exclude them at the one call site that most needs them.
 *
 * `getCourses` (`src/app/actions/course.ts`) builds the same union in row form
 * because it needs each offering's course payload; this module is the predicate
 * form, for callers that only need to match.
 */
import prisma from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';

/** Ids of the courses this organisation adopted from another tenant's catalogue. */
export async function listAdoptedCourseIds(organizationId: string): Promise<string[]> {
  const offerings = await prisma.orgCourseOffering.findMany({
    where: { organizationId },
    select: { courseId: true },
  });
  return offerings.map((offering) => offering.courseId);
}

/**
 * Prisma `where` matching every course the organisation can use — authored
 * in-house OR adopted. Spread it alongside further filters: Prisma ANDs sibling
 * fields with the `OR`, so `{ ...(await orgCourseWhere(id)), type: 'video' }`
 * means "an org course that is also a video", not "an org course or any video".
 */
export async function orgCourseWhere(organizationId: string): Promise<Prisma.CourseWhereInput> {
  const adoptedCourseIds = await listAdoptedCourseIds(organizationId);
  if (adoptedCourseIds.length === 0) return { organizationId };
  return { OR: [{ organizationId }, { id: { in: adoptedCourseIds } }] };
}
