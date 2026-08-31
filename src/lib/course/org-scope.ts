/**
 * "Which courses belong to this organisation" — the single definition.
 *
 * `Course` has no `organizationId` column. A course written in-house is tied to
 * the org only through its creator's `OrganizationUser`, while a course taken
 * from the platform catalogue is tied through an `OrgCourseOffering` row and is
 * authored by ANOTHER tenant entirely. A query that spells out only the first
 * half — as every audit-report query did — silently drops every adopted course,
 * which for a video-only customer means an empty catalogue.
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
  if (adoptedCourseIds.length === 0) return { creator: { organizationId } };
  return { OR: [{ creator: { organizationId } }, { id: { in: adoptedCourseIds } }] };
}
