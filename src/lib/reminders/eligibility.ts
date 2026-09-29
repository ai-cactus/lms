import prisma from '@/lib/prisma';
import type { EnrollmentStatus } from '@/generated/prisma/enums';
import {
  isFinishedStatus,
  retakesOfWhere,
  supersededEnrollmentIds,
} from '@/lib/dashboard/definitions';

/**
 * Whether an enrolment may still be the subject of a reminder.
 *
 * Track A and Track B apply this rule in their own queries, but a reminder can
 * outlive the moment it was claimed: a failed email waits for the retry
 * pre-pass, and an un-summarized `ReminderLog`/`ReminderNudge` waits up to a day
 * for the cycle summary. By then the learner may have finished, been handed a
 * retake, or had the course archived under them (BUG-45 / BUG-31, ruled
 * 2026-09-28: drop them). Every late consumer re-checks through this module so
 * the three reasons cannot drift apart.
 */

/** The enrolment state a late reminder consumer must re-check. */
export interface ReminderEnrollmentState {
  id: string;
  organizationUserId: string;
  status: EnrollmentStatus;
  courseArchivedAt: Date | null;
}

/**
 * The ids in `rows` that a retake has superseded (BUG-44). From the moment an
 * admin assigns a retake, the retake carries the obligation, so nothing may
 * remind about or escalate the original — the rule the dashboards and the
 * Status Tracker already apply (BUG-38). ANY retake counts, finished or not:
 * once the learner has passed it, escalating the locked original would chase an
 * obligation that is already met.
 *
 * One query for the whole batch. Pinned to the batch's own members because a
 * retake always belongs to the member who held the original, which also keeps
 * the lookup inside each row's tenant.
 */
export async function findSupersededIds(
  rows: readonly { id: string; organizationUserId: string }[],
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const retakes = await prisma.enrollment.findMany({
    where: {
      ...retakesOfWhere(rows.map((r) => r.id)),
      organizationUserId: { in: [...new Set(rows.map((r) => r.organizationUserId))] },
    },
    select: { retakeOf: true },
  });
  return supersededEnrollmentIds(retakes);
}

/**
 * The ids in `rows` no reminder may still be about: finished (completed or
 * attested), superseded by a retake, or on an archived course. Duplicate rows
 * for one enrolment are fine. At most one query, and none when every row is
 * already decided by its own state.
 */
export async function findIneligibleEnrollmentIds(
  rows: readonly ReminderEnrollmentState[],
): Promise<Set<string>> {
  const ineligible = new Set<string>();
  const undecided = new Map<string, ReminderEnrollmentState>();
  for (const row of rows) {
    if (isFinishedStatus(row.status) || row.courseArchivedAt !== null) ineligible.add(row.id);
    else undecided.set(row.id, row);
  }

  for (const id of await findSupersededIds([...undecided.values()])) ineligible.add(id);
  return ineligible;
}
