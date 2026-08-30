import { z } from 'zod';
import { RenewalCycle, UserRole } from '@/generated/prisma/enums';
import { combineDateAndTime } from '@/lib/reminders/deadline';
import { logger } from '@/lib/logger';

/**
 * Assignment intent captured by the course wizard but withheld because the
 * F-051 quality gate held the new course as a draft. Enrolling learners fires
 * launch emails and seeds reminder ladders, none of which can be undone, so the
 * intent is parked on `Course.pendingAssignment` and replayed by `publishCourse`
 * once an admin acknowledges the warnings.
 *
 * Each variant mirrors the arguments of the call it defers — `enrollUsers` for
 * named individuals, `assignCourseToRoles` for whole roles. The wizard's assign
 * & publish step targets one or the other, never both.
 */
const pendingEmailAssignmentSchema = z.object({
  mode: z.literal('email'),
  emails: z.array(z.string()).min(1),
  /** Absolute deadline, already combined from the wizard's date + time. */
  dueAt: z.string().nullish(),
});

/**
 * Mirrors `RoleAssignmentSettingsInput`. Every setting stays optional so an
 * absent key replays as `undefined` — `assignCourseToRoles` distinguishes that
 * from an empty array (no reminder stages) when seeding the ladder.
 */
const pendingRoleAssignmentSchema = z.object({
  mode: z.literal('roles'),
  roles: z.array(z.enum(UserRole)).min(1),
  dueDate: z.string().nullish(),
  dueTime: z.string().nullish(),
  dueWindowDays: z.number().int().nullish(),
  remindersEnabled: z.boolean().optional(),
  reminderDaysBefore: z.array(z.number().int()).optional(),
  renewalCycle: z.enum(RenewalCycle).optional(),
});

export const pendingAssignmentSchema = z.discriminatedUnion('mode', [
  pendingEmailAssignmentSchema,
  pendingRoleAssignmentSchema,
]);

export type PendingAssignment = z.infer<typeof pendingAssignmentSchema>;

/** Role-targeting settings the wizard collects alongside its role selection. */
export interface RoleAssignmentIntent {
  roles: UserRole[];
  dueWindowDays?: number | null;
  remindersEnabled?: boolean;
  reminderDaysBefore?: number[];
  renewalCycle?: RenewalCycle;
}

/**
 * Turn the wizard's assign & publish selection into the payload to park on the
 * course.
 * Returns null when nothing was targeted, so an untargeted draft leaves the
 * column untouched.
 */
export function buildPendingAssignment(input: {
  assignments?: string[];
  roleAssignment?: RoleAssignmentIntent;
  dueDate?: Date;
  dueTime?: string;
}): PendingAssignment | null {
  if (input.roleAssignment && input.roleAssignment.roles.length > 0) {
    const { roles, ...settings } = input.roleAssignment;
    return {
      mode: 'roles',
      roles,
      dueDate: input.dueDate ? input.dueDate.toISOString() : null,
      dueTime: input.dueTime ?? null,
      ...settings,
    };
  }

  if (input.assignments && input.assignments.length > 0) {
    return {
      mode: 'email',
      emails: input.assignments,
      dueAt: combineDateAndTime(input.dueDate, input.dueTime)?.toISOString() ?? null,
    };
  }

  return null;
}

/**
 * Validate a `Course.pendingAssignment` column value.
 *
 * Returns null for a genuinely empty column and for a malformed one alike — a
 * blob written by an older shape must never block a publish. Callers that need
 * to tell the two apart check the column for null themselves; a malformed value
 * is logged here so the lost intent is traceable.
 */
export function parsePendingAssignment(
  value: unknown,
  context: { courseId: string },
): PendingAssignment | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = pendingAssignmentSchema.safeParse(value);
  if (!parsed.success) {
    logger.warn({
      msg: '[course] Malformed pendingAssignment — deferred assignment discarded',
      courseId: context.courseId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'),
    });
    return null;
  }

  return parsed.data;
}
