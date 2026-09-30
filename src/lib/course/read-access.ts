import { canViewOrgCourses } from '@/lib/rbac/role-utils';

/**
 * RISK-15: may this caller review a course — open it, see its media — as a
 * manager of the organisation that OWNS it, with no enrolment of their own?
 *
 * Ownership is `Course.organizationId` (Q25), exactly as
 * `isCourseEditableByOrganization` reads it for edits. Not the author's
 * membership (`createdByOrgUserId`) and not the author's CURRENT organisation
 * (`creator.organizationId`): both follow the person, so a course keyed on them
 * went dark for the organisation that owns it and stayed readable by whichever
 * organisation its author joined next.
 *
 * `canViewOrgCourses` is the role half: every worker role holds `course.read`
 * for its own enrolments, so the verb alone would admit every learner, and
 * Finance holds nothing on Courses. Global catalogue access, enrolment and
 * Q-15's retired-thumbnail rule are separate grants each caller keeps.
 */
export function isCourseOrganizationReviewer(
  course: { organizationId: string },
  caller: { organizationId?: string | null; role?: string | null },
): boolean {
  return (
    Boolean(caller.organizationId) &&
    course.organizationId === caller.organizationId &&
    canViewOrgCourses(caller.role)
  );
}
