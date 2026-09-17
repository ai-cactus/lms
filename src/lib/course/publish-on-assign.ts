import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * A course staff can actually take is not a draft — and now the assign paths
 * REFUSE rather than proceed when that cannot be made true.
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
 * ⛔ The maintainer has since ruled that no learner may be enrolled in a draft.
 * The transition below already runs before the first enrollment write, so the
 * ruling holds by construction — what did NOT hold was the failure case: this
 * used to log and return, leaving the caller to enrol into a course still
 * marked `draft`. It now REPORTS whether the course is in service, and every
 * assign path refuses when it is not. The Assign & Publish flow is unaffected:
 * its draft is published here, as before, and only then enrolled.
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
 * Never throws: the caller decides what a failure means, and it has a refusal
 * shape that survives production error redaction where a thrown message does
 * not. It logs as well, because a silent skip here is exactly how the original
 * inconsistency stayed invisible.
 *
 * D9 — this is the THIRD publish path, and until now the only one that recorded
 * no reviewer, so a course could go live attributed to nobody. The person who
 * assigns a draft is taking responsibility for it going live, so the attribution
 * is written alongside the status flip. It needs the caller's
 * `OrganizationUser` id, not their `User` id: `approvedByOrgUserId` is a
 * membership FK, which is also what lets the details-page hero render the
 * approver's role without a second lookup.
 *
 * @returns `true` when the course is in service (no longer a draft) and may be
 * enrolled into; `false` when it is still a draft, which every assign path
 * treats as a refusal.
 */
export async function publishCourseOnAssignment(
  course: { id: string; status: string; isGlobal: boolean; reviewRequired: boolean },
  actorUserId: string,
  approvedByOrgUserId: string | null,
): Promise<boolean> {
  if (course.status !== 'draft') return true;
  // A draft this function may not publish stays a draft, so the caller must
  // refuse. Both cases are already blocked upstream — a global course is not
  // ours to publish and a held one is refused by the review gate — so reaching
  // here means an upstream gate has drifted, and failing closed is the point.
  if (course.isGlobal || course.reviewRequired) return false;

  try {
    await prisma.course.update({
      where: { id: course.id },
      data: { status: 'published', approvedByOrgUserId, approvedAt: new Date() },
    });
    logger.info({
      msg: '[course] Draft published because it was assigned to staff',
      courseId: course.id,
      userId: actorUserId,
    });
    return true;
  } catch (err) {
    logger.error({
      msg: '[course] Could not publish a course that was just assigned — assignment refused',
      err,
      courseId: course.id,
      userId: actorUserId,
    });
    return false;
  }
}
