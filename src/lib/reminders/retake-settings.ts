import type { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';

/**
 * The CourseAssignment fields that shape an enrolment's reminder ladder. Shared
 * by every reader so an enrolment's own assignment and the one a retake
 * inherits have the same shape.
 */
export const reminderAssignmentSelect = {
  remindersEnabled: true,
  reminderStages: { select: { stage: true, offsetDays: true, enabled: true, channels: true } },
} satisfies Prisma.CourseAssignmentSelect;

export type ReminderAssignment = Prisma.CourseAssignmentGetPayload<{
  select: typeof reminderAssignmentSelect;
}>;

/**
 * Longest `retakeOf` chain walked. A chain is one hop per retake an admin
 * assigned; the bound only stops a cycle or corrupt data from looping.
 */
const MAX_RETAKE_CHAIN = 25;

/**
 * Q-28 (ruled): a retake follows the reminder settings of the assignment its
 * ORIGINAL enrolment came from. `assignRetake` writes no `assignmentId`, so
 * without this a retake ran the default ladder even when the organisation had
 * switched reminders off or customised the stages for that course.
 *
 * Walks each row's `retakeOf` chain to its root (the enrolment with no
 * `retakeOf`) and returns that root's assignment. The map holds an entry for
 * every row that has a `retakeOf`; the value is `null` — meaning the default
 * ladder — when the root has no assignment, the chain is broken (the original
 * was deleted; `retakeOf` is a bare column with no FK), crosses to another
 * member, or does not end within {@link MAX_RETAKE_CHAIN} hops.
 *
 * One query per hop for the whole batch, and none when no row is a retake.
 * Every ancestor must belong to the row's own member, as a retake always does,
 * which also keeps the walk inside the row's tenant.
 */
export async function resolveRetakeRootAssignments(
  rows: readonly { id: string; organizationUserId: string; retakeOf: string | null }[],
): Promise<Map<string, ReminderAssignment | null>> {
  const resolved = new Map<string, ReminderAssignment | null>();
  const pending = new Map<string, { organizationUserId: string; cursor: string }>();
  for (const row of rows) {
    if (row.retakeOf) {
      pending.set(row.id, { organizationUserId: row.organizationUserId, cursor: row.retakeOf });
    }
  }

  for (let hop = 0; pending.size > 0 && hop < MAX_RETAKE_CHAIN; hop += 1) {
    const ancestors = await prisma.enrollment.findMany({
      where: { id: { in: [...new Set([...pending.values()].map((p) => p.cursor))] } },
      select: {
        id: true,
        organizationUserId: true,
        retakeOf: true,
        assignment: { select: reminderAssignmentSelect },
      },
    });
    const ancestorById = new Map(ancestors.map((a) => [a.id, a]));

    for (const [rowId, step] of pending) {
      const ancestor = ancestorById.get(step.cursor);
      if (!ancestor || ancestor.organizationUserId !== step.organizationUserId) {
        resolved.set(rowId, null);
        pending.delete(rowId);
      } else if (ancestor.retakeOf === null) {
        resolved.set(rowId, ancestor.assignment);
        pending.delete(rowId);
      } else {
        step.cursor = ancestor.retakeOf;
      }
    }
  }

  for (const rowId of pending.keys()) resolved.set(rowId, null);
  return resolved;
}
