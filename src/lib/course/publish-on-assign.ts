import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * A course staff can actually take is not a draft.
 *
 * `status` was never enforced on the assign path — `enrollUsers` and
 * `assignCourseToRoleTargets` gate on `reviewRequired`, deliberately, so an
 * ordinary unheld draft stays assignable (the Assign & Publish flow depends on
 * it). Forks start life as `draft` with `reviewRequired: false`, so duplicating
 * a course and assigning it from a staff profile produced a course learners
 * took, completed and earned certificates for, while the record — and therefore
 * the audit report — still read "Draft".
 *
 * Only the `/assign` page closed that gap, and only for itself. This makes the
 * transition follow the ACT of assignment wherever it happens.
 *
 * Deliberately narrow:
 *  - only `draft` moves. `inactive` is a deliberate retirement, and silently
 *    reviving a retired course because someone assigned it would be a surprise
 *    of its own; `published` is a no-op, so this is idempotent across
 *    re-assignment.
 *  - a global course belongs to another tenant's catalogue; its lifecycle is not
 *    ours to change (and it is already published, or assignment refused it).
 *  - a review-held course is never published here — assignment is blocked for it
 *    upstream, and the quality gate is the only thing that may clear that.
 *
 * Never throws: failing to relabel a course must not fail the assignment that
 * has already been authorised. It logs instead, because a silent skip here is
 * exactly how the original inconsistency stayed invisible.
 */
export async function publishCourseOnAssignment(
  course: { id: string; status: string; isGlobal: boolean; reviewRequired: boolean },
  actorUserId: string,
): Promise<void> {
  if (course.status !== 'draft' || course.isGlobal || course.reviewRequired) return;

  try {
    await prisma.course.update({
      where: { id: course.id },
      data: { status: 'published' },
    });
    logger.info({
      msg: '[course] Draft published because it was assigned to staff',
      courseId: course.id,
      userId: actorUserId,
    });
  } catch (err) {
    logger.error({
      msg: '[course] Could not publish a course that was just assigned — status now understates it',
      err,
      courseId: course.id,
      userId: actorUserId,
    });
  }
}
