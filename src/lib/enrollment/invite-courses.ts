import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  createEnrollmentForUser,
  type CreateEnrollmentContext,
  type DeferredWorkerNotification,
} from './create';
import { collectDeferredNotices, notifyCoursesAssigned } from './notify';

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
 * helper's existing-enrollment check — a re-accept enrolls nothing and therefore
 * announces nothing. Every course materialised in this run is announced in ONE
 * email and ONE in-app notification. Never throws — a failure here must not
 * abort the accept path.
 */
export async function enrollInviteCourses(
  organizationUserId: string,
  inviteId: string,
): Promise<void> {
  try {
    const invite = await prisma.invite.findUnique({
      where: { id: inviteId },
      select: {
        organizationId: true,
        facilityId: true,
        courseAssignments: { select: { courseId: true } },
      },
    });

    if (!invite || invite.courseAssignments.length === 0) {
      return;
    }

    // Only enroll for the invite's own org — never cross-tenant. The accept
    // paths create this membership in that org just before calling us, so
    // scoping the lookup by organizationId is the whole guard.
    const membership = await prisma.organizationUser.findFirst({
      where: { id: organizationUserId, organizationId: invite.organizationId, active: true },
      select: {
        user: { select: { email: true } },
        organization: { select: { name: true } },
      },
    });

    if (!membership) {
      return;
    }

    const deferred: DeferredWorkerNotification[] = [];

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
        organizationName: membership.organization?.name || 'Your Organization',
        facilityId: invite.facilityId,
        assignmentId: assignment?.id ?? null,
        scheduleAt: assignment?.scheduleAt ?? null,
        assignmentDueAt: assignment?.dueAt ?? null,
        assignmentWindowDays: assignment?.dueWindowDays ?? null,
        enrolledByUserId: organizationUserId,
        // An invite can park several courses; batch them into one notice rather
        // than emailing the new member once per course.
        deferWorkerNotification: true,
      };

      const outcome = await createEnrollmentForUser({ email: membership.user.email }, ctx);

      if (outcome.status === 'enrolled') {
        if (outcome.deferred) {
          deferred.push(outcome.deferred);
        }
        logger.info({
          msg: '[enrollment] Invite-parked course enrolled on accept',
          organizationUserId,
          courseId,
          inviteId,
        });
      }
    }

    for (const notice of collectDeferredNotices(deferred)) {
      await notifyCoursesAssigned(notice);
    }
  } catch (err) {
    logger.error({
      msg: '[enrollment] Invite-course enroll on accept failed',
      organizationUserId,
      inviteId,
      err,
    });
  }
}
