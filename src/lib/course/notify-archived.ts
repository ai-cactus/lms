import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isNotificationChannelEnabled } from '@/lib/notifications/category-preferences';

/**
 * Founder Q-05 (2026-09-23): archiving is never blocked by live enrolments, but
 * the learners who were part-way through MUST be told the course is cancelled —
 * every action they had left (finishing it, the quiz, attestation, a retake) is
 * refused from this moment on.
 *
 * ## Tier
 *
 * Instant, delivered at archive time. The catalog's `tier` table
 * (`ENGINE_EVENTS`) governs `emitNotificationEvent`, which resolves recipients
 * from ROLES; this notice is addressed to named learners instead, so it takes
 * the same learner funnel as `COURSE_ASSIGNED` and `RETAKE_ASSIGNED` — a
 * `createNotification`-shaped write at the moment the business action commits.
 * That is also the correct tier on its merits: a cancellation is something the
 * learner has to act on straight away (stop working on it, stop expecting to
 * finish), and batching it into the next day's cycle summary would let them
 * keep pushing at a course the server is already refusing.
 *
 * ## Who counts as an active learner
 *
 * Everyone short of `attested`. Attestation is the terminal compliance act, so
 * an attested learner has nothing left to lose — their record and certificate
 * are retained untouched (Q-04). Anyone else, including a `completed` learner
 * whose attestation is now refused and a `locked` learner waiting on a retake
 * that is now refused, had a pending action that archiving has just cancelled.
 *
 * Deactivated members are excluded for the reason the reminder sweep excludes
 * them: their enrolments are retained for compliance (Q23), but telling someone
 * whose access was revoked about a course they can no longer open is noise.
 */

/** Notification type key — also registered in the catalog for chips/preferences. */
const COURSE_CANCELLED = 'COURSE_CANCELLED';

export interface CourseCancelledNoticeResult {
  /** Memberships a bell row was written for. */
  notifiedCount: number;
}

/**
 * Tell every active learner that an archived course has been cancelled.
 *
 * Never throws: the archive is already committed, so a failure here must not
 * roll it back or surface as a failed delete.
 *
 * Batched rather than one `createNotification` per learner — a mandatory course
 * can carry hundreds of enrolments and an admin is waiting on the Server Action
 * that calls this.
 */
export async function notifyLearnersCourseCancelled(course: {
  id: string;
  title: string;
}): Promise<CourseCancelledNoticeResult> {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        courseId: course.id,
        status: { not: 'attested' },
        organizationUser: { is: { active: true } },
      },
      select: {
        organizationUser: { select: { id: true, organizationId: true } },
      },
    });

    if (enrollments.length === 0) return { notifiedCount: 0 };

    // One membership can hold several enrolments on the same course (a retake
    // sits alongside the locked original) — one notice each, not one per row.
    const organizationIdByMembership = new Map<string, string>();
    for (const enrollment of enrollments) {
      organizationIdByMembership.set(
        enrollment.organizationUser.id,
        enrollment.organizationUser.organizationId,
      );
    }

    // The in-app switch is org-wide, and a course's roster can span tenants
    // (an adopted video course), so it is resolved once per organization.
    const organizationIds = [...new Set(organizationIdByMembership.values())];
    const enabledByOrganization = new Map<string, boolean>();
    for (const organizationId of organizationIds) {
      enabledByOrganization.set(
        organizationId,
        await isNotificationChannelEnabled(organizationId, COURSE_CANCELLED, 'inApp'),
      );
    }

    const candidateIds = [...organizationIdByMembership.entries()]
      .filter(([, organizationId]) => enabledByOrganization.get(organizationId))
      .map(([membershipId]) => membershipId);

    if (candidateIds.length === 0) return { notifiedCount: 0 };

    const optedOut = await prisma.notificationPreference.findMany({
      where: {
        organizationUserId: { in: candidateIds },
        type: COURSE_CANCELLED,
        enabled: false,
      },
      select: { organizationUserId: true },
    });
    const optedOutIds = new Set(optedOut.map((row) => row.organizationUserId));
    const recipientIds = candidateIds.filter((id) => !optedOutIds.has(id));

    if (recipientIds.length === 0) return { notifiedCount: 0 };

    await prisma.notification.createMany({
      data: recipientIds.map((organizationUserId) => ({
        organizationUserId,
        type: COURSE_CANCELLED,
        title: 'Training Cancelled',
        message: `"${course.title}" has been cancelled by your organization. You no longer need to complete it.`,
        linkUrl: '/worker/trainings',
        metadata: { courseId: course.id, courseTitle: course.title },
      })),
    });

    logger.info({
      msg: '[course] Course cancellation notice sent to active learners',
      courseId: course.id,
      recipientCount: recipientIds.length,
    });

    return { notifiedCount: recipientIds.length };
  } catch (err) {
    logger.error({
      msg: '[course] Course cancellation notice failed',
      courseId: course.id,
      err,
    });
    return { notifiedCount: 0 };
  }
}
