import type { Prisma } from '@/generated/prisma/client';

/**
 * Which of a member's active facility assignments is "their facility".
 *
 * A member may hold several (supervisors routinely do). Oldest-first makes the
 * pick deterministic; `id` breaks a same-instant tie. Shared by the enrolment
 * stamp (`resolveMemberFacilityId`) and the course roster's current-facility
 * column, so the two can never name different facilities for one person.
 *
 * Kept free of the Prisma client so the course-detail select, which a client
 * component's types reach, can import it.
 */
export const OLDEST_ASSIGNMENT_FIRST: Prisma.OrganizationUserFacilityOrderByWithRelationInput[] = [
  { joinedAt: 'asc' },
  { id: 'asc' },
];
