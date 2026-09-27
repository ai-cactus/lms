import type prisma from '@/lib/prisma';

/**
 * Minimum gap between two engagement stamps on the same enrolment. Heartbeat
 * callers (video progress, quiz autosave) fire every few seconds; the dormancy
 * rules work in days, so a write per heartbeat would be wasted I/O.
 */
export const ENROLLMENT_ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;

/**
 * The Prisma delegate this module needs. Both the base client and the
 * transaction client passed to `prisma.$transaction(async (tx) => …)` satisfy
 * it, so callers can stamp inside an existing transaction.
 */
type EnrollmentActivityDbClient = Pick<typeof prisma, 'enrollment'>;

/**
 * Record learner engagement on an enrolment that is not otherwise being
 * updated. Callers that already write the enrolment should set
 * `lastActivityAt` in that same update instead.
 *
 * Learner-initiated events only — never call this from an admin action or a
 * sweep, or dormancy reporting would read admin activity as engagement.
 */
export async function touchEnrollmentActivity(
  db: EnrollmentActivityDbClient,
  enrollmentId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.enrollment.updateMany({
    where: {
      id: enrollmentId,
      OR: [
        { lastActivityAt: null },
        { lastActivityAt: { lt: new Date(now.getTime() - ENROLLMENT_ACTIVITY_THROTTLE_MS) } },
      ],
    },
    data: { lastActivityAt: now },
  });
}
