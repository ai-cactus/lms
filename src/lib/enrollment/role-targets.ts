import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createEnrollmentForUser, type CreateEnrollmentContext } from './create';
import type { UserRole } from '@/generated/prisma/enums';

/**
 * Live auto-enroll for role-target course assignments.
 *
 * A {@link CourseAssignment} with a non-null `targetRole` enrolls every CURRENT
 * holder of that role AND anyone who gains it later. This shared hook implements
 * the "gains it later" half: it is called from every site that creates an org
 * user with — or changes an existing user to — a role, so the enrollment happens
 * the moment the role is assigned (not only on the nightly reconciliation sweep).
 *
 * The per-user deadline counts from the user's role-join date: role-target
 * assignments never carry an absolute `dueAt` (enforced in {@link assignCourseToRole}),
 * so the effective deadline is `roleAssignedAt + assignment.dueWindowDays`
 * (falling through to the system default when the window is unset). Idempotent —
 * an already-enrolled user is a no-op via {@link createEnrollmentForUser}'s
 * existence check. Never throws: an auto-enroll failure must not abort the caller
 * (staff edit, invite accept, signup) — the sweep backstop reconciles anything
 * missed here.
 */
export async function enrollUserForRoleTargets(
  userId: string,
  organizationId: string,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        role: true,
        roleAssignedAt: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    });

    // Only enroll for the caller's own org — never cross-tenant. A user with no
    // org (or a mismatched one) has no role-target assignments to satisfy.
    if (!user || user.organizationId !== organizationId) {
      return;
    }

    const assignments = await prisma.courseAssignment.findMany({
      where: { organizationId, targetRole: user.role as UserRole },
      select: {
        id: true,
        courseId: true,
        dueWindowDays: true,
        course: { select: { title: true } },
      },
    });

    if (assignments.length === 0) {
      return;
    }

    for (const assignment of assignments) {
      // Count the deadline window from the role-join date by feeding it as the
      // schedule/start; a role-target assignment never has an absolute dueAt.
      const ctx: CreateEnrollmentContext = {
        courseId: assignment.courseId,
        courseTitle: assignment.course.title,
        organizationId,
        organizationName: user.organization?.name || 'Your Organization',
        facilityId: null,
        assignmentId: assignment.id,
        scheduleAt: user.roleAssignedAt,
        assignmentDueAt: null,
        assignmentWindowDays: assignment.dueWindowDays,
        enrolledByUserId: userId,
      };

      const outcome = await createEnrollmentForUser({ email: user.email }, ctx);

      if (outcome.status === 'enrolled') {
        logger.info({
          msg: '[enrollment] Role-target auto-enroll',
          userId,
          role: user.role,
          courseId: assignment.courseId,
          assignmentId: assignment.id,
        });
      }
    }
  } catch (err) {
    logger.error({
      msg: '[enrollment] Role-target auto-enroll failed',
      userId,
      organizationId,
      err,
    });
  }
}
