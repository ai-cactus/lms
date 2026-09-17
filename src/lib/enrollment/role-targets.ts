import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createEnrollmentForUser, type CreateEnrollmentContext } from './create';
import { assignmentAdmitsHolder } from './assignment-facility-scope';
import type { UserRole } from '@/generated/prisma/enums';

/**
 * Live auto-enroll for role-target course assignments.
 *
 * A {@link CourseAssignment} whose `targetRoles` contains a role enrolls every
 * CURRENT holder of that role AND anyone who gains it later. This shared hook
 * implements the "gains it later" half: it is called from every site that creates
 * an org user with — or changes an existing user to — a role, so the enrollment
 * happens the moment the role is assigned (not only on the nightly reconciliation
 * sweep).
 *
 * The per-user deadline follows the same resolution as every other enrollment: an
 * absolute `dueAt` on the assignment wins, otherwise the window counts from the
 * membership's role-join date — `OrganizationUser.roleAssignedAt +
 * assignment.dueWindowDays` (falling through to the system default when the
 * window is unset). A late joiner therefore shares the cohort's hard deadline
 * when one was set at assignment time.
 *
 * An assignment reaches a new holder only inside the facility scope its author
 * had — see {@link assignmentAdmitsHolder}. Org-wide assignments carry no scope
 * and so reach everyone, exactly as before. An ARCHIVED course never reaches a
 * new holder at all: archiving retires a course for new assignment, and the
 * assignment row outlives it. Idempotent —
 * an already-enrolled user is a no-op via {@link createEnrollmentForUser}'s
 * existence check. Never throws: an auto-enroll failure must not abort the caller
 * (staff edit, invite accept, signup) — the sweep backstop reconciles anything
 * missed here.
 */
export async function enrollUserForRoleTargets(
  organizationUserId: string,
  organizationId: string,
): Promise<void> {
  try {
    // Only enroll for the caller's own org — never cross-tenant. Scoping the
    // lookup by organizationId makes a mismatched membership simply not found.
    const membership = await prisma.organizationUser.findFirst({
      where: { id: organizationUserId, organizationId, active: true },
      select: {
        role: true,
        roleAssignedAt: true,
        user: { select: { email: true } },
        organization: { select: { name: true } },
        facilities: { where: { active: true }, select: { facilityId: true } },
      },
    });

    if (!membership) {
      return;
    }

    // `targetRoles` is the authoritative list — rows written before multi-role
    // targeting were backfilled from the superseded `targetRole` column, and
    // every write path keeps the two in sync, so a single `has` covers both.
    const assignments = await prisma.courseAssignment.findMany({
      where: { organizationId, targetRoles: { has: membership.role as UserRole } },
      select: {
        id: true,
        courseId: true,
        dueAt: true,
        dueWindowDays: true,
        facilityScoped: true,
        facilityIds: true,
        // ⚠️ `archivedAt` is selected and checked in the loop below rather than
        // left to the Q24 archive filter: that filter is a query extension on
        // top-level `course` reads, and `CourseAssignment.course` is a NESTED
        // relation it cannot reach. Restating `course: { archivedAt: null }` in
        // the `where` would work too, but skipping in the loop is what makes the
        // skip observable — see the facility-scope skip immediately below.
        course: { select: { title: true, archivedAt: true } },
      },
    });

    if (assignments.length === 0) {
      return;
    }

    const holderFacilityIds = membership.facilities.map((link) => link.facilityId);

    for (const assignment of assignments) {
      // Archiving a course retires it for NEW assignment; it does not erase what
      // a learner already did. The assignment row survives the archive, so
      // without this a role change keeps minting fresh obligations on a course
      // the organisation has retired. A normal outcome, not an error — the
      // caller (staff edit, invite accept, signup) proceeds either way.
      if (assignment.course.archivedAt !== null) {
        logger.info({
          msg: '[enrollment] Role-target auto-enroll skipped — course archived',
          organizationUserId,
          assignmentId: assignment.id,
          courseId: assignment.courseId,
        });
        continue;
      }

      // Honour the reach the assigner actually had. Without this the assignment
      // would keep enrolling new joiners at facilities its author cannot see, so
      // a facility-bound supervisor's assignment would silently widen over time.
      if (!assignmentAdmitsHolder(assignment, holderFacilityIds)) {
        logger.info({
          msg: '[enrollment] Role-target auto-enroll skipped — outside assignment facility scope',
          organizationUserId,
          assignmentId: assignment.id,
          courseId: assignment.courseId,
        });
        continue;
      }

      // Count the deadline window from the role-join date by feeding it as the
      // schedule/start; an absolute dueAt, when the assignment carries one, wins
      // over the window inside createEnrollmentForUser.
      const ctx: CreateEnrollmentContext = {
        courseId: assignment.courseId,
        courseTitle: assignment.course.title,
        organizationId,
        organizationName: membership.organization?.name || 'Your Organization',
        facilityId: null,
        assignmentId: assignment.id,
        scheduleAt: membership.roleAssignedAt,
        assignmentDueAt: assignment.dueAt,
        assignmentWindowDays: assignment.dueWindowDays,
        enrolledByUserId: organizationUserId,
      };

      const outcome = await createEnrollmentForUser({ email: membership.user.email }, ctx);

      if (outcome.status === 'enrolled') {
        logger.info({
          msg: '[enrollment] Role-target auto-enroll',
          organizationUserId,
          role: membership.role,
          courseId: assignment.courseId,
          assignmentId: assignment.id,
        });
      }
    }
  } catch (err) {
    logger.error({
      msg: '[enrollment] Role-target auto-enroll failed',
      organizationUserId,
      organizationId,
      err,
    });
  }
}
