import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createEnrollmentForUser, type CreateEnrollmentContext } from './create';

/**
 * Materialise the courses parked on an accepted invite into real enrollments.
 *
 * When a course is assigned to an unknown / org-less email, no user or enrollment
 * is created — the course is stored as an {@link @/generated/prisma InviteCourseAssignment}
 * on a `/join` invite (see {@link createEnrollmentForUser}). This hook runs at
 * invite-accept time, once the account exists and belongs to the org, to turn
 * each parked course into an enrollment.
 *
 * Mirrors {@link enrollUserForRoleTargets}: schedule/deadline settings are
 * resolved from the org's latest {@link @/generated/prisma CourseAssignment} row
 * for the course (with sensible fallbacks when none exists — the default deadline
 * window in {@link createEnrollmentForUser} then applies). Idempotent via that
 * helper's existing-enrollment check. Never throws — a failure here must not
 * abort the accept path.
 */
export async function enrollInviteCourses(userId: string, inviteId: string): Promise<void> {
  try {
    const invite = await prisma.invite.findUnique({
      where: { id: inviteId },
      select: {
        organizationId: true,
        courseAssignments: { select: { courseId: true } },
      },
    });

    if (!invite || invite.courseAssignments.length === 0) {
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        facilityId: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    });

    // Only enroll for the invite's own org — never cross-tenant. The accept paths
    // relink/create the user into this org just before calling us.
    if (!user || user.organizationId !== invite.organizationId) {
      return;
    }

    for (const { courseId } of invite.courseAssignments) {
      // Resolve the org's live schedule/deadline for this course; fall back to a
      // bare context (createEnrollmentForUser computes the default deadline window)
      // when no assignment row exists.
      const assignment = await prisma.courseAssignment.findFirst({
        where: { organizationId: invite.organizationId, courseId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          scheduleAt: true,
          dueAt: true,
          dueWindowDays: true,
          course: { select: { title: true } },
        },
      });

      const courseTitle =
        assignment?.course.title ??
        (await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } }))
          ?.title;

      if (!courseTitle) {
        continue;
      }

      const ctx: CreateEnrollmentContext = {
        courseId,
        courseTitle,
        organizationId: invite.organizationId,
        organizationName: user.organization?.name || 'Your Organization',
        facilityId: user.facilityId,
        assignmentId: assignment?.id ?? null,
        scheduleAt: assignment?.scheduleAt ?? null,
        assignmentDueAt: assignment?.dueAt ?? null,
        assignmentWindowDays: assignment?.dueWindowDays ?? null,
        enrolledByUserId: userId,
      };

      const outcome = await createEnrollmentForUser({ email: user.email }, ctx);

      if (outcome.status === 'enrolled') {
        logger.info({
          msg: '[enrollment] Invite-parked course enrolled on accept',
          userId,
          courseId,
          inviteId,
        });
      }
    }
  } catch (err) {
    logger.error({
      msg: '[enrollment] Invite-course enroll on accept failed',
      userId,
      inviteId,
      err,
    });
  }
}
