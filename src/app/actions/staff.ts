'use server';

import { BILLING_GATE_ASSIGN_MESSAGE } from '@/lib/billing';
import prisma from '@/lib/prisma';
import {
  isAdminRole,
  ADMIN_ROLES,
  dbRoleToRoleKey,
  canChangeRole,
  type RoleChangeDenyReason,
} from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import type { EnrollmentStatus, UserRole } from '@/generated/prisma/enums';
import { enrollUsers, type AssignmentSettingsInput } from '@/app/actions/enrollment';
import { enrollUserForRoleTargets } from '@/lib/enrollment/role-targets';
import { resolveDataFacilityIds, staffFacilityWhere } from '@/lib/facility/staff-where';
import { logger, maskEmail } from '@/lib/logger';
import type { DeferredWorkerNotification } from '@/lib/enrollment/create';
import { collectDeferredNotices, notifyCoursesAssigned } from '@/lib/enrollment/notify';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';
import { invalidateRevalidationCache } from '@/lib/auth/session-revalidation-cache';
import type { ActivityReportEnrollment } from '@/lib/pdf-reports';

// Caller-facing copy for each role-change denial. `target_not_reachable` and
// `role_not_grantable` are only reachable when an owner is involved (owner is in
// no grant list), so both reuse the established owner-immutability message.
const ROLE_CHANGE_DENIED_MESSAGES: Record<RoleChangeDenyReason, string> = {
  actor_not_permitted: "Only an Owner or Supervisor can change a staff member's role.",
  self_change: 'You cannot change your own role.',
  target_not_reachable:
    'The Owner role cannot be changed here. It is set only when an organization is created.',
  role_not_grantable:
    'The Owner role cannot be assigned. It is set only when an organization is created.',
};

/**
 * `organizationUserId` identifies the person's membership in the caller's org
 * (per the multi-org model, "a person within an organization" is an
 * OrganizationUser row, not a bare identity).
 */
export async function getStaffDetails(organizationUserId: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  // D-01: was `isAdminRole`, which admits Finance and Clinical Director —
  // neither holds `user.read`.
  const roleKey = dbRoleToRoleKey(session.user.role);
  if (!roleKey || !can(roleKey, 'user.read')) {
    logger.warn({
      msg: '[staff] Staff detail read denied',
      userId: session.user.id,
      role: session.user.role,
    });
    throw new Error('Unauthorized');
  }

  // null for org-wide roles; an array (possibly empty) for a facility-bound one.
  const dataFacilityIds = await resolveDataFacilityIds(session);

  try {
    // findFirst, not findUnique, so the tenancy and facility predicates compose
    // into the query rather than being checked after the row is already loaded.
    // An out-of-facility target must return null exactly as a non-existent id
    // does — a distinguishable response would confirm the person exists.
    const orgUser = await prisma.organizationUser.findFirst({
      where: {
        id: organizationUserId,
        organizationId: session.user.organizationId,
        ...staffFacilityWhere(dataFacilityIds),
      },
      // Explicit projection — this DTO never needs the credential columns behind
      // the joined User rows (password hash, MFA state, reset flags).
      select: {
        id: true,
        role: true,
        jobTitle: true,
        organizationId: true,
        managerId: true,
        user: { select: { email: true, fullName: true, avatarUrl: true } },
        manager: { select: { user: { select: { email: true, fullName: true } } } },
        facilities: {
          where: { active: true },
          take: 1,
          select: { facility: { select: { name: true } } },
        },
        enrollments: {
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            courseId: true,
            status: true,
            progress: true,
            score: true,
            startedAt: true,
            completedAt: true,
            dueAt: true,
            course: {
              select: {
                title: true,
                thumbnail: true,
                type: true,
                lessons: {
                  select: { quiz: { select: { passingScore: true, allowedAttempts: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!orgUser) return null;

    // Tenant isolation. Now REDUNDANT — `organizationId` moved into the query
    // above — and deliberately kept: this is a tenancy boundary, and if the
    // predicate is ever dropped from the `where` this still catches it. It
    // should be unreachable; the log firing means the query lost its filter.
    if (orgUser.organizationId !== session.user.organizationId) {
      logger.warn({
        msg: '[staff] Cross-tenant staff detail access blocked',
        userId: session.user.id,
        targetOrgUserId: organizationUserId,
      });
      return null;
    }

    // F-001: record PII (staff profile) access on the authorized, org-scoped path.
    await audit({
      action: 'staff.profile.access',
      actorId: session.user.id,
      actorRole: session.user.role,
      organizationId: session.user.organizationId,
      targetType: 'user',
      targetId: organizationUserId,
      ...getClientContext(await headers()),
    });

    const totalCourses = orgUser.enrollments.length || 0;
    const completedCourses =
      orgUser.enrollments.filter((e) => {
        const passingScore = e.course.lessons.find((l) => l.quiz)?.quiz?.passingScore || 70;
        return (
          e.status === 'completed' ||
          e.status === 'attested' ||
          (e.progress === 100 && (e.score || 0) >= passingScore)
        );
      }).length || 0;

    const failedCourses =
      orgUser.enrollments.filter((e) => {
        const isFinished = e.status === 'completed' || e.progress === 100;
        const hasScore = e.score !== null;
        const passingScore = e.course.lessons.find((l) => l.quiz)?.quiz?.passingScore || 70;
        return isFinished && hasScore && (e.score || 0) < passingScore;
      }).length || 0;

    // Active courses are those in progress but NOT failed yet
    const activeCourses = Math.max(0, totalCourses - completedCourses - failedCourses);

    return {
      user: {
        id: orgUser.id,
        name: orgUser.user.fullName || orgUser.user.email.split('@')[0],
        email: orgUser.user.email,
        avatarUrl: orgUser.user.avatarUrl ?? null,
        role: orgUser.role,
        jobTitle: orgUser.jobTitle || 'Staff Member',
        facilityName: orgUser.facilities[0]?.facility.name ?? null,
        managerId: orgUser.managerId ?? null,
        managerName: orgUser.manager
          ? (orgUser.manager.user.fullName ?? orgUser.manager.user.email)
          : null,
      },
      stats: {
        totalCourses,
        completedCourses,
        failedCourses,
        activeCourses,
      },
      enrollments: orgUser.enrollments.map((e) => ({
        id: e.id,
        courseId: e.courseId,
        courseName: e.course.title,
        courseImage: e.course.thumbnail,
        courseType: e.course.type,
        status: e.status,
        progress: e.progress,
        score: e.score ?? 0,
        enrolledAt: e.startedAt,
        completedAt: e.completedAt,
        dueAt: e.dueAt?.toISOString() ?? null,
        allowedAttempts: e.course.lessons.find((l) => l.quiz)?.quiz?.allowedAttempts ?? undefined,
        passingScore: e.course.lessons.find((l) => l.quiz)?.quiz?.passingScore || 70,
      })),
    };
  } catch (error) {
    logger.error({ msg: 'Failed to fetch staff details:', err: error });
    return null;
  }
}

export async function updateStaffDetails(
  organizationUserId: string,
  data: {
    firstName: string;
    lastName: string;
    role: UserRole;
    jobTitle: string;
  },
) {
  const session = await auth();
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    !can(dbRoleToRoleKey(session.user.role), 'user.edit')
  ) {
    return { success: false, error: 'Unauthorized' };
  }

  // Tenant isolation: an admin may only edit users that belong to their own org.
  const target = await prisma.organizationUser.findUnique({
    where: { id: organizationUserId },
    select: { userId: true, organizationId: true, role: true },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    return { success: false, error: 'Forbidden' };
  }

  // A role change is a privileged, narrower operation than a name/job-title edit:
  // only an Owner/Supervisor may re-role a reachable target, never themselves,
  // and never to/from owner. Unchanged role (e.g. a plain profile edit) skips it.
  const roleChanged = data.role !== target.role;
  if (roleChanged) {
    const decision = canChangeRole(
      session.user.role,
      session.user.id,
      target.userId,
      target.role,
      data.role,
    );
    if (!decision.allowed) {
      logger.warn({
        msg: '[staff] Role change denied',
        actorId: session.user.id,
        targetOrgUserId: organizationUserId,
        reason: decision.reason,
      });
      return { success: false, error: ROLE_CHANGE_DENIED_MESSAGES[decision.reason!] };
    }
  }

  try {
    await prisma.organizationUser.update({
      where: { id: organizationUserId },
      data: {
        role: data.role,
        jobTitle: data.jobTitle,
        // Stamp the role-join date so late-joiner deadline windows count from the
        // change.
        ...(roleChanged ? { roleAssignedAt: new Date() } : {}),
      },
    });

    if (roleChanged) {
      // Bump sessionVersion on the identity so the target's live sessions are
      // invalidated on their next JWT decode — their new permission ceiling
      // takes effect immediately (F-059 kill-switch precedent).
      await prisma.user.update({
        where: { id: target.userId },
        data: { sessionVersion: { increment: 1 } },
      });

      // Evict the cached revalidation snapshot so that next decode reads the
      // new sessionVersion immediately rather than waiting out the Redis TTL.
      await invalidateRevalidationCache(target.userId);

      await audit({
        action: 'staff.role.change',
        actorId: session.user.id,
        actorRole: session.user.role,
        organizationId: session.user.organizationId,
        targetType: 'user',
        targetId: organizationUserId,
        metadata: { fromRole: target.role, toRole: data.role },
        ...getClientContext(await headers()),
      });
      logger.info({
        msg: '[staff] Role changed',
        actorId: session.user.id,
        targetOrgUserId: organizationUserId,
        fromRole: target.role,
        toRole: data.role,
      });

      // Live auto-enroll: the user now holds a new role, so enroll them in any
      // active role-target assignments for it. Never throws.
      await enrollUserForRoleTargets(organizationUserId, session.user.organizationId);
    }

    await prisma.user.update({
      where: { id: target.userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: `${data.firstName} ${data.lastName}`.trim(),
      },
    });

    revalidatePath(`/dashboard/staff/${organizationUserId}`);
    revalidatePath('/dashboard/staff');
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Failed to update staff details:', err: error });
    return { success: false, error: 'Failed to update user details' };
  }
}

/**
 * Returns the same-org users that are eligible to be assigned as a staff
 * member's manager. Per the current product decision, managers must be
 * admin-role (full RBAC is a separate effort). The caller's UI excludes the
 * staff member themselves from the resulting list.
 */
export async function getAssignableManagers(): Promise<
  { id: string; name: string; email: string }[]
> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  // D-01: returns names and emails, so it is a roster read — gate on user.read.
  const roleKey = dbRoleToRoleKey(session.user.role);
  if (!roleKey || !can(roleKey, 'user.read')) {
    logger.warn({
      msg: '[staff] Assignable-manager read denied',
      userId: session.user.id,
      role: session.user.role,
    });
    throw new Error('Unauthorized');
  }

  const dataFacilityIds = await resolveDataFacilityIds(session);

  // Restrict to the caller's own organization — never return users from other tenants.
  const admins = await prisma.organizationUser.findMany({
    where: {
      organizationId: session.user.organizationId,
      active: true,
      role: { in: [...ADMIN_ROLES] },
      ...staffFacilityWhere(dataFacilityIds),
    },
    include: {
      user: true,
    },
    orderBy: {
      joinedAt: 'desc',
    },
  });

  return admins.map((admin) => ({
    id: admin.id,
    name: admin.user.fullName || admin.user.email,
    email: admin.user.email,
  }));
}

/**
 * Sets (or clears) the manager for a staff member. Enforces multi-tenant
 * isolation and the integrity rules: the manager must belong to the same
 * organization, must be admin-role, and cannot be the staff member themselves.
 * `staffOrgUserId`/`managerOrgUserId` identify OrganizationUser memberships —
 * `OrganizationUser.managerId` now references another membership, not a bare
 * identity.
 */
export async function setStaffManager(
  staffOrgUserId: string,
  managerOrgUserId: string | null,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    !can(dbRoleToRoleKey(session.user.role), 'user.edit')
  ) {
    return { success: false, error: 'Unauthorized' };
  }

  // Tenant isolation: an admin may only manage users that belong to their own org.
  const staff = await prisma.organizationUser.findUnique({
    where: { id: staffOrgUserId },
    select: { organizationId: true },
  });
  if (!staff || staff.organizationId !== session.user.organizationId) {
    return { success: false, error: 'Forbidden' };
  }

  if (managerOrgUserId !== null) {
    if (managerOrgUserId === staffOrgUserId) {
      return { success: false, error: 'A staff member cannot be their own manager' };
    }

    const manager = await prisma.organizationUser.findUnique({
      where: { id: managerOrgUserId },
      select: { organizationId: true, role: true },
    });
    if (!manager || manager.organizationId !== session.user.organizationId) {
      return { success: false, error: 'Forbidden — manager not in your organization' };
    }
    if (!isAdminRole(manager.role)) {
      return { success: false, error: 'Manager must be an admin' };
    }
  }

  try {
    await prisma.organizationUser.update({
      where: { id: staffOrgUserId },
      data: { managerId: managerOrgUserId },
    });

    logger.info({
      msg: '[staff] Manager set',
      staffOrgUserId,
      managerOrgUserId,
      userId: session.user.id,
    });

    // F-001: record the sensitive mutation on the authorized, successful path.
    await audit({
      action: 'staff.manager.set',
      actorId: session.user.id,
      actorRole: session.user.role,
      organizationId: session.user.organizationId,
      targetType: 'user',
      targetId: staffOrgUserId,
      metadata: { managerId: managerOrgUserId },
      ...getClientContext(await headers()),
    });

    revalidatePath(`/dashboard/staff/${staffOrgUserId}`);
    revalidatePath('/dashboard/staff');
    return { success: true };
  } catch (error) {
    logger.error({ msg: '[staff] Failed to set manager', err: error, staffOrgUserId });
    return { success: false, error: 'Failed to update manager' };
  }
}

/**
 * Replaces a staff member's facility assignments with exactly `facilityIds`.
 *
 * Powers both the single-select "change facility" move and multi-facility
 * assignment: assignments not in the set are REVOKED (`active = false`) rather
 * than deleted, and the ones in it are created or reactivated. Enrollments and
 * certificates hang off the membership, not the facility, so training history is
 * preserved by construction — which is what the modal's "records preserved" copy
 * promises.
 */
export async function setStaffFacilities(
  organizationUserId: string,
  facilityIds: string[],
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    !can(dbRoleToRoleKey(session.user.role), 'user.edit')
  ) {
    return { success: false, error: 'Unauthorized' };
  }

  const targetFacilityIds = [...new Set(facilityIds)];
  if (targetFacilityIds.length === 0) {
    return { success: false, error: 'Select at least one facility.' };
  }

  // Tenant isolation: an admin may only reassign users that belong to their own org.
  const target = await prisma.organizationUser.findUnique({
    where: { id: organizationUserId },
    select: { organizationId: true, role: true },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    return { success: false, error: 'Forbidden' };
  }

  // The owner spans the whole organization — their facility scope is not
  // reassignable by anyone.
  if (target.role === 'owner') {
    return { success: false, error: "The organization owner's facilities cannot be changed." };
  }

  // ...and every requested facility must belong to that same org, so a crafted
  // request can never place a staff member inside another tenant.
  const ownedFacilities = await prisma.facility.findMany({
    where: { id: { in: targetFacilityIds }, organizationId: session.user.organizationId },
    select: { id: true },
  });
  if (ownedFacilities.length !== targetFacilityIds.length) {
    logger.warn({
      msg: '[staff] Facility assignment rejected — facility not in organization',
      actorId: session.user.id,
      targetOrgUserId: organizationUserId,
    });
    return { success: false, error: 'One or more facilities are not in your organization.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.organizationUserFacility.updateMany({
        where: { organizationUserId, active: true, facilityId: { notIn: targetFacilityIds } },
        data: { active: false, deactivatedAt: new Date() },
      });

      for (const facilityId of targetFacilityIds) {
        await tx.organizationUserFacility.upsert({
          where: { organizationUserId_facilityId: { organizationUserId, facilityId } },
          update: { active: true, deactivatedAt: null },
          create: { organizationUserId, facilityId },
        });
      }
    });

    logger.info({
      msg: '[staff] Facility assignments set',
      actorId: session.user.id,
      targetOrgUserId: organizationUserId,
      facilityCount: targetFacilityIds.length,
    });

    // F-001: record the sensitive mutation on the authorized, successful path.
    await audit({
      action: 'staff.facilities.set',
      actorId: session.user.id,
      actorRole: session.user.role,
      organizationId: session.user.organizationId,
      targetType: 'user',
      targetId: organizationUserId,
      metadata: { facilityIds: targetFacilityIds },
      ...getClientContext(await headers()),
    });

    revalidatePath(`/dashboard/staff/${organizationUserId}`);
    revalidatePath('/dashboard/staff');
    return { success: true };
  } catch (error) {
    logger.error({
      msg: '[staff] Failed to set facility assignments',
      err: error,
      targetOrgUserId: organizationUserId,
    });
    return { success: false, error: 'Failed to update facility assignments' };
  }
}

/**
 * @deprecated Superseded by {@link assignCoursesToStaffMember}, which assigns
 * 1..N courses in one action and emits a single batched notice. Kept as the
 * instant revert path for the staff-profile assign dialog.
 *
 * Assigns a course to a single staff member from their profile. This path is
 * gated on `user.edit` (roster management) — deliberately distinct from the
 * Courses-module assignment, which is gated on enrollment rights. Finance and
 * Clinical Director therefore cannot assign from a staff profile even though a
 * Clinical Director retains course-assignment rights elsewhere. Resolves the
 * target's email and delegates to the unchanged `enrollUsers`, which owns the
 * enrollment/invite/notification mechanics.
 */
export async function assignCourseToStaffMember(
  courseId: string,
  staffOrgUserId: string,
  assignmentSettings?: AssignmentSettingsInput,
): Promise<{
  success: string[];
  alreadyEnrolled: string[];
  newInvited: string[];
  failed: string[];
  error?: string;
}> {
  const session = await auth();
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    !can(dbRoleToRoleKey(session.user.role), 'user.edit')
  ) {
    return { success: [], alreadyEnrolled: [], newInvited: [], failed: [], error: 'Unauthorized' };
  }

  // Tenant isolation: only assign to a staff member within the caller's own org.
  const target = await prisma.organizationUser.findUnique({
    where: { id: staffOrgUserId },
    select: { organizationId: true, user: { select: { email: true } } },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    return { success: [], alreadyEnrolled: [], newInvited: [], failed: [], error: 'Forbidden' };
  }

  // enrollUsers returns a `refusedReason` for the review and billing gates, and
  // still throws on hard failures (unauthorized, unknown course). Normalize both
  // into this action's return shape so the calling modal surfaces the specific
  // message instead of falling back to a generic failed state.
  try {
    const outcome = await enrollUsers(courseId, [{ email: target.user.email }], assignmentSettings);
    if (outcome.refusedReason) {
      return {
        success: [],
        alreadyEnrolled: [],
        newInvited: [],
        failed: [staffOrgUserId],
        error: outcome.refusedReason,
      };
    }
    return outcome;
  } catch (err) {
    return {
      success: [],
      alreadyEnrolled: [],
      newInvited: [],
      failed: [staffOrgUserId],
      error: err instanceof Error ? err.message : 'Failed to assign course',
    };
  }
}

/** Upper bound on one multi-course assignment — see {@link assignCoursesToStaffMember}. */
const MAX_COURSES_PER_ASSIGNMENT = 50;

export interface AssignCoursesToStaffResult {
  /** Newly assigned — exactly the courses the batched email lists. */
  assigned: { courseId: string; courseTitle: string }[];
  alreadyAssigned: { courseId: string; courseTitle: string }[];
  /** `courseTitle` is null for an id that resolves to no course at all. */
  failed: { courseId: string; courseTitle: string | null }[];
  invited: boolean;
  emailSent: boolean;
  error?: string;
}

/**
 * Assign one or more courses to a staff member from their profile in a single
 * action, announcing all of them in ONE email and ONE in-app notification.
 *
 * Gated on `assignment.create` (course-assignment rights) rather than the roster
 * permission the single-course predecessor uses, so every role that may assign
 * courses elsewhere — Clinical Director included — may assign them here too.
 *
 * Partial failure is expected and reported, never fatal: already-enrolled and
 * unassignable courses are bucketed and skipped, and only the newly assigned
 * ones are announced. Nothing newly assigned ⇒ no email and no notification.
 */
export async function assignCoursesToStaffMember(
  staffOrgUserId: string,
  courseIds: string[],
  options?: { dueAt?: string | Date | null },
): Promise<AssignCoursesToStaffResult> {
  const result: AssignCoursesToStaffResult = {
    assigned: [],
    alreadyAssigned: [],
    failed: [],
    invited: false,
    emailSent: false,
  };

  const session = await auth();
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    !can(dbRoleToRoleKey(session.user.role), 'assignment.create')
  ) {
    logger.warn({
      msg: '[enrollment] Multi-course staff assignment denied — missing assignment.create',
      staffOrgUserId,
      userId: session?.user?.id,
      role: session?.user?.role,
    });
    return { ...result, error: 'Unauthorized' };
  }

  const uniqueCourseIds = [
    ...new Set(courseIds.map((id) => id?.trim()).filter((id): id is string => !!id)),
  ];
  if (uniqueCourseIds.length === 0) {
    return { ...result, error: 'Select at least one course to assign.' };
  }
  if (uniqueCourseIds.length > MAX_COURSES_PER_ASSIGNMENT) {
    return {
      ...result,
      error: `You can assign at most ${MAX_COURSES_PER_ASSIGNMENT} courses at a time.`,
    };
  }

  let dueAt: Date | null = null;
  if (options?.dueAt) {
    const parsed = options.dueAt instanceof Date ? options.dueAt : new Date(options.dueAt);
    if (Number.isNaN(parsed.getTime())) {
      return { ...result, error: 'The deadline is not a valid date.' };
    }
    if (parsed.getTime() <= Date.now()) {
      return { ...result, error: 'The deadline must be in the future.' };
    }
    dueAt = parsed;
  }

  // Tenant isolation: only assign to a staff member within the caller's own org.
  const target = await prisma.organizationUser.findUnique({
    where: { id: staffOrgUserId },
    select: { organizationId: true, user: { select: { email: true } } },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    logger.warn({
      msg: '[enrollment] Multi-course staff assignment denied — cross-tenant target',
      staffOrgUserId,
      orgId: session.user.organizationId,
      userId: session.user.id,
    });
    return { ...result, error: 'Forbidden' };
  }

  // Titles for the result payload only — `enrollUsers` still runs the real
  // ownership / offering / publish / billing checks per course.
  const courses = await prisma.course.findMany({
    where: { id: { in: uniqueCourseIds } },
    select: { id: true, title: true },
  });
  const titleById = new Map(courses.map((course) => [course.id, course.title]));

  const assignmentSettings: AssignmentSettingsInput | undefined = dueAt ? { dueAt } : undefined;
  const deferred: DeferredWorkerNotification[] = [];

  for (const courseId of uniqueCourseIds) {
    const courseTitle = titleById.get(courseId);
    if (courseTitle === undefined) {
      result.failed.push({ courseId, courseTitle: null });
      continue;
    }

    try {
      // Sequential, not Promise.all: each iteration writes org-scoped rows, so
      // serialising avoids write contention and keeps the logs deterministic.
      const outcome = await enrollUsers(
        courseId,
        [{ email: target.user.email }],
        assignmentSettings,
        {
          deferWorkerNotification: true,
          assignmentSettingsMode: 'preserve',
        },
      );

      if (outcome.refusedReason) {
        // The billing gate is organization-wide: no other course in this batch
        // can succeed either, so abort rather than failing them one by one.
        if (outcome.refusedReason === BILLING_GATE_ASSIGN_MESSAGE) {
          logger.warn({
            msg: '[enrollment] Multi-course staff assignment aborted — billing gate',
            staffOrgUserId,
            orgId: session.user.organizationId,
            userId: session.user.id,
          });
          result.error = outcome.refusedReason;
          break;
        }

        // Course held for quality review: nothing was written for this course.
        // Report it as failed like any other per-course problem and continue.
        logger.warn({
          msg: '[enrollment] Course could not be assigned to staff member — held for quality review',
          staffOrgUserId,
          courseId,
          userId: session.user.id,
        });
        result.failed.push({ courseId, courseTitle });
        continue;
      }

      if (outcome.success.length > 0) {
        result.assigned.push({ courseId, courseTitle });
        if (outcome.deferred) {
          deferred.push(...outcome.deferred);
        }
      } else if (outcome.alreadyEnrolled.length > 0) {
        result.alreadyAssigned.push({ courseId, courseTitle });
      } else if (outcome.newInvited.length > 0) {
        // Unreachable for a confirmed org member (the tenancy check above proves
        // one), but if it ever happens the member was reached by the `/join`
        // invite email naming this course, so report it as assigned.
        result.invited = true;
        result.assigned.push({ courseId, courseTitle });
      } else {
        result.failed.push({ courseId, courseTitle });
      }
    } catch (err) {
      logger.error({
        msg: '[enrollment] Course could not be assigned to staff member',
        staffOrgUserId,
        courseId,
        userId: session.user.id,
        err,
      });
      result.failed.push({ courseId, courseTitle });
    }
  }

  // Zero newly assigned ⇒ the loop body never runs ⇒ no email, no notification.
  for (const notice of collectDeferredNotices(deferred)) {
    const emitted = await notifyCoursesAssigned(notice);
    result.emailSent = result.emailSent || emitted.emailSent;
  }

  logger.info({
    msg: '[enrollment] Multi-course staff assignment complete',
    staffOrgUserId,
    orgId: session.user.organizationId,
    userId: session.user.id,
    requested: uniqueCourseIds.length,
    assigned: result.assigned.length,
    alreadyAssigned: result.alreadyAssigned.length,
    failed: result.failed.length,
    emailSent: result.emailSent,
  });

  if (result.assigned.length > 0) {
    // F-001: record the sensitive mutation on the authorized, successful path.
    await audit({
      action: 'staff.courses.assign',
      actorId: session.user.id,
      actorRole: session.user.role,
      organizationId: session.user.organizationId,
      targetType: 'user',
      targetId: staffOrgUserId,
      metadata: {
        courseIds: result.assigned.map((course) => course.courseId),
        dueAt: dueAt ? dueAt.toISOString() : null,
      },
      ...getClientContext(await headers()),
    });
  }

  revalidatePath(`/dashboard/staff/${staffOrgUserId}`);
  revalidatePath('/dashboard/staff');
  return result;
}

export async function getEnrollmentQuizResult(enrollmentId: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  // D-01: exposes another person's quiz answers and score.
  const roleKey = dbRoleToRoleKey(session.user.role);
  if (!roleKey || !can(roleKey, 'assignment.read')) {
    logger.warn({
      msg: '[staff] Quiz result read denied',
      userId: session.user.id,
      role: session.user.role,
    });
    throw new Error('Unauthorized');
  }

  const dataFacilityIds = await resolveDataFacilityIds(session);

  try {
    // findFirst so the facility predicate composes into the query — an
    // out-of-facility enrollment must be indistinguishable from a missing one.
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        id: enrollmentId,
        organizationUser: { is: staffFacilityWhere(dataFacilityIds) },
      },
      include: {
        organizationUser: {
          include: {
            user: true,
            organization: true,
          },
        },
        course: true,
        quizAttempts: {
          orderBy: { completedAt: 'desc' },
          take: 1,
          include: {
            quiz: {
              include: {
                questions: true,
              },
            },
          },
        },
      },
    });

    if (!enrollment || enrollment.quizAttempts.length === 0) {
      return null;
    }

    // Tenant isolation: an admin may only view quiz results for enrollments that
    // belong to a user in their own organization — never expose correct answers
    // or worker identity across tenants.
    if (enrollment.organizationUser.organizationId !== session.user.organizationId) {
      logger.warn({
        msg: '[staff] Cross-tenant quiz result access blocked',
        userId: session.user.id,
        enrollmentId,
      });
      return null;
    }

    // F-001: record quiz-result (PII) access on the authorized, org-scoped path.
    await audit({
      action: 'staff.quiz_result.access',
      actorId: session.user.id,
      actorRole: session.user.role,
      organizationId: session.user.organizationId,
      targetType: 'enrollment',
      targetId: enrollmentId,
      ...getClientContext(await headers()),
    });

    const latestAttempt = enrollment.quizAttempts[0];
    const quiz = latestAttempt.quiz;
    const userAnswers = Array.isArray(latestAttempt.answers)
      ? (latestAttempt.answers as {
          questionId: string;
          selectedAnswer: string;
          explanation?: string;
        }[])
      : [];

    const questions = quiz.questions.map((q) => {
      const userAnswerObj = userAnswers.find((a) => a.questionId === q.id);
      const optionsArray = Array.isArray(q.options)
        ? (q.options as (string | { text: string })[])
        : [];
      const optionTexts = optionsArray.map((opt) =>
        typeof opt === 'string' ? opt : (opt as { text: string }).text || String(opt),
      );

      const formattedOptions = optionTexts.map((text, idx) => ({
        id: String.fromCharCode(65 + idx),
        text: text,
      }));

      const selectedText = userAnswerObj?.selectedAnswer || '';
      const selectedIdx = optionTexts.findIndex((t: string) => t === selectedText);
      const selectedAnswerId = selectedIdx >= 0 ? String.fromCharCode(65 + selectedIdx) : '';

      const correctText = q.correctAnswer || '';
      const correctIdx = optionTexts.findIndex((t: string) => t === correctText);
      const correctAnswerId = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : '';

      return {
        id: q.id,
        text: q.text,
        options: formattedOptions,
        selectedAnswer: selectedAnswerId,
        correctAnswer: correctAnswerId,
        explanation: userAnswerObj?.explanation || '',
      };
    });

    const correctCount = questions.filter((q) => q.selectedAnswer === q.correctAnswer).length;
    const wrongCount = questions.length - correctCount;

    return {
      courseName: enrollment.course.title,
      score: latestAttempt.score,
      answered: questions.filter((q) => q.selectedAnswer).length,
      correct: correctCount,
      wrong: wrongCount,
      time: latestAttempt.timeTaken || 0,
      userName: enrollment.organizationUser.user.fullName || enrollment.organizationUser.user.email,
      organizationName: enrollment.organizationUser.organization.name || undefined,
      questions: questions,
      attemptsUsed: latestAttempt.attemptCount,
      allowedAttempts: quiz.allowedAttempts,
      passingScore: quiz.passingScore,
    };
  } catch (error) {
    logger.error({ msg: 'Failed to fetch quiz result:', err: error });
    return null;
  }
}

export async function removeStaff(organizationUserId: string) {
  try {
    const session = await auth();
    if (!session?.user?.email || !session?.user?.id || !session.user.organizationUserId) {
      throw new Error('Unauthorized');
    }

    // Self-removal would deactivate the caller's own membership mid-session and
    // can orphan the organization — removal must always be done by someone else.
    if (organizationUserId === session.user.organizationUserId) {
      throw new Error('You cannot remove your own account from the organization.');
    }

    const admin = await prisma.organizationUser.findUnique({
      where: { id: session.user.organizationUserId },
      select: {
        role: true,
        organizationId: true,
        user: { select: { email: true } },
        organization: { select: { name: true } },
      },
    });

    if (!admin || !can(dbRoleToRoleKey(admin.role), 'user.delete')) {
      throw new Error('Insufficient permissions or organization not found');
    }

    const staffOrgUser = await prisma.organizationUser.findUnique({
      where: { id: organizationUserId },
      select: {
        organizationId: true,
        userId: true,
        role: true,
        user: { select: { email: true, fullName: true } },
      },
    });

    if (!staffOrgUser) {
      throw new Error('User not found');
    }

    if (staffOrgUser.organizationId !== admin.organizationId) {
      throw new Error('User does not belong to your organization');
    }

    // The owner seat is established at org creation and can never be revoked —
    // not even by an admin holding user.delete.
    if (staffOrgUser.role === 'owner') {
      throw new Error('The organization owner cannot be removed.');
    }

    const staffName = staffOrgUser.user.fullName || staffOrgUser.user.email;

    // Drop in-flight training on removal so a re-invite yields a clean slate.
    // Only the "active" statuses (the F-053 partial-index set) are deleted —
    // cascading their ReminderLog / ReminderNudge / QuizAttempt rows. Terminal
    // statuses (completed, attested, locked, failed, retry_requested) and their
    // certificates are retained for compliance history.
    const ACTIVE_ENROLLMENT_STATUSES: EnrollmentStatus[] = [
      'enrolled',
      'assigned',
      'in_progress',
      'lessons_complete',
    ];

    // Single transaction: deactivate the membership, bump the identity's
    // sessionVersion so any live session is invalidated on its next JWT decode
    // (F-059 kill-switch), drop the in-flight enrollments, and expire any
    // pending invite for this email in the org so a live `/join` token can't
    // immediately re-add the person.
    const [droppedEnrollments] = await prisma.$transaction([
      prisma.enrollment.deleteMany({
        where: { organizationUserId, status: { in: ACTIVE_ENROLLMENT_STATUSES } },
      }),
      prisma.organizationUser.update({
        where: { id: organizationUserId },
        data: { active: false, deactivatedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: staffOrgUser.userId },
        data: { sessionVersion: { increment: 1 } },
      }),
      prisma.invite.updateMany({
        where: {
          email: staffOrgUser.user.email,
          organizationId: admin.organizationId,
          status: 'pending',
        },
        data: { status: 'expired' },
      }),
    ]);

    // The unlink bumped sessionVersion; evict the cached revalidation snapshot
    // so the removed user's next decode misses the cache and is invalidated.
    await invalidateRevalidationCache(staffOrgUser.userId);

    // F-001: record the sensitive mutation on the authorized, successful path.
    await audit({
      action: 'staff.remove',
      actorId: session.user.id,
      actorRole: admin.role,
      organizationId: admin.organizationId,
      targetType: 'user',
      targetId: organizationUserId,
      metadata: { droppedEnrollmentCount: droppedEnrollments.count },
      ...getClientContext(await headers()),
    });

    revalidatePath('/dashboard/staff');

    // Send notification emails (non-blocking for better UX)
    try {
      const { sendStaffRemovedEmail, sendStaffRemovalConfirmationEmail } =
        await import('@/lib/email');

      // Notify the worker
      await sendStaffRemovedEmail(staffOrgUser.user.email, admin.organization.name);

      // Confirm to the admin
      await sendStaffRemovalConfirmationEmail(admin.user.email, staffName, admin.organization.name);
    } catch (emailError) {
      logger.error({
        msg: '[Email Error] Failed to send staff removal notifications:',
        err: emailError,
      });
    }

    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove staff member';
    logger.error({ msg: 'Error removing staff:', err: error });
    return { success: false, error: errorMessage };
  }
}

export async function revokeInvite(inviteId: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  if (!can(dbRoleToRoleKey(session.user.role), 'invite.delete')) {
    throw new Error('Insufficient permissions');
  }

  const invite = await prisma.invite.findUnique({
    where: { id: inviteId },
    select: { organizationId: true },
  });

  if (!invite) {
    throw new Error('Invite not found');
  }

  if (invite.organizationId !== session.user.organizationId) {
    throw new Error('Invite does not belong to your organization');
  }

  await prisma.invite.delete({ where: { id: inviteId } });

  revalidatePath('/dashboard/staff');
  return { success: true };
}

/**
 * Resends a pending invite, regenerating its token and 7-day expiry so an
 * expired (or soon-to-expire) invite becomes usable again. Used by the staff
 * list to recover invites that lapsed before the recipient accepted them.
 */
export async function resendInvite(
  inviteId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    if (!session.user.organizationId || !can(dbRoleToRoleKey(session.user.role), 'invite.edit')) {
      throw new Error('Insufficient permissions');
    }

    const invite = await prisma.invite.findUnique({
      where: { id: inviteId },
      select: {
        organizationId: true,
        email: true,
        role: true,
        status: true,
        organization: { select: { name: true } },
      },
    });

    if (!invite) {
      throw new Error('Invite not found');
    }

    if (invite.organizationId !== session.user.organizationId) {
      throw new Error('Invite does not belong to your organization');
    }

    if (invite.status === 'accepted') {
      return { success: false, error: 'This invite has already been accepted.' };
    }

    // Regenerate the token + expiry so any previously-shared (now stale) link is
    // invalidated and the recipient gets a fresh 7-day window.
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.invite.update({
      where: { id: inviteId },
      data: { token, expiresAt, status: 'pending' },
    });

    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${token}`;
    const { sendInviteEmail } = await import('@/lib/email');
    await sendInviteEmail(invite.email, inviteLink, invite.organization.name, invite.role);

    logger.info({
      msg: '[staff] Invite resent',
      inviteId,
      organizationId: session.user.organizationId,
    });

    revalidatePath('/dashboard/staff');
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to resend invite';
    logger.error({ msg: 'Error resending invite:', err: error });
    return { success: false, error: errorMessage };
  }
}

/**
 * Generates a PDF activity report for a specific staff member and emails
 * it to the requesting admin.
 *
 * @param staffUserId - The ID of the worker whose report to generate.
 */
export async function generateStaffActivityPdfAndEmail(
  staffOrgUserId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    // D-01: this emails a PDF of one person's full training record — the same
    // egress class as the auditor export, and it was gated on `isAdminRole`.
    const roleKey = dbRoleToRoleKey(session.user.role);
    if (!roleKey || !can(roleKey, 'user.read') || !session.user.organizationId) {
      logger.warn({
        msg: '[staff] Activity PDF export denied',
        userId: session.user.id,
        role: session.user.role,
      });
      return { success: false, error: 'Forbidden' };
    }

    const dataFacilityIds = await resolveDataFacilityIds(session);

    // Verify the target staff belongs to the same organization AND is within
    // the caller's facility scope.
    const staffOrgUser = await prisma.organizationUser.findFirst({
      where: {
        id: staffOrgUserId,
        organizationId: session.user.organizationId,
        ...staffFacilityWhere(dataFacilityIds),
      },
      select: {
        organizationId: true,
        user: { select: { email: true, fullName: true } },
        enrollments: {
          select: {
            id: true,
            courseId: true,
            status: true,
            score: true,
            startedAt: true,
            completedAt: true,
            course: {
              select: { id: true, title: true, category: true },
            },
          },
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!staffOrgUser) {
      return { success: false, error: 'Staff member not found' };
    }

    // Redundant since `organizationId` moved into the query above; kept as a
    // backstop on the tenancy boundary. Unreachable in normal operation.
    if (staffOrgUser.organizationId !== session.user.organizationId) {
      return { success: false, error: 'Forbidden — staff member not in your organization' };
    }

    const org = await prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      select: { name: true },
    });

    const staffName = staffOrgUser.user.fullName ?? staffOrgUser.user.email.split('@')[0];
    const orgName = org?.name ?? 'Your Organization';

    // Build the report data
    const { generateUserActivityPdf } = await import('@/lib/pdf-reports');

    const enrollments: ActivityReportEnrollment[] = staffOrgUser.enrollments.map((e) => ({
      courseId: e.course.id,
      courseTitle: e.course.title,
      type: 'Course',
      category: e.course.category,
      score: e.score,
      dateAssigned: e.startedAt,
      dateCompleted: e.completedAt,
      status: e.status,
    }));

    const pdfBuffer = await generateUserActivityPdf({
      userName: staffName,
      orgName,
      generatedAt: new Date(),
      enrollments,
    });

    // Send to admin
    const { sendUserActivityReportEmail } = await import('@/lib/email');
    const result = await sendUserActivityReportEmail(
      session.user.email,
      staffName,
      orgName,
      pdfBuffer,
    );

    if (!result.success) {
      return {
        success: false,
        error: 'PDF generated but email delivery failed. Please try again.',
      };
    }

    logger.info({
      msg: '[staff] Activity PDF report sent',
      staffOrgUserId,
      adminEmail: maskEmail(session.user.email),
    });

    return { success: true };
  } catch (error) {
    logger.error({ msg: '[staff] Failed to generate activity PDF', err: error });
    return { success: false, error: 'An unexpected error occurred. Please try again.' };
  }
}
