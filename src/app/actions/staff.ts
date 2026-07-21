'use server';

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
import type { UserRole } from '@/generated/prisma/enums';
import { enrollUsers, type AssignmentSettingsInput } from '@/app/actions/enrollment';
import { enrollUserForRoleTargets } from '@/lib/enrollment/role-targets';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';
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

export async function getStaffDetails(userId: string) {
  const session = await auth();
  if (!session?.user?.id || !isAdminRole(session.user.role) || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        manager: {
          include: { profile: true },
        },
        enrollments: {
          include: {
            course: {
              include: {
                lessons: {
                  include: { quiz: true },
                },
              },
            },
            quizAttempts: {
              orderBy: { completedAt: 'desc' },
              take: 1,
            },
          },
          orderBy: {
            startedAt: 'desc',
          },
        },
      },
    });

    if (!user) return null;

    // Tenant isolation: an admin may only view users that belong to their own org.
    if (user.organizationId !== session.user.organizationId) {
      logger.warn({
        msg: '[staff] Cross-tenant staff detail access blocked',
        userId: session.user.id,
        targetUserId: userId,
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
      targetId: userId,
      ...getClientContext(await headers()),
    });

    const totalCourses = user.enrollments.length || 0;
    const completedCourses =
      user.enrollments.filter((e) => {
        const passingScore = e.course.lessons.find((l) => l.quiz)?.quiz?.passingScore || 70;
        return (
          e.status === 'completed' ||
          e.status === 'attested' ||
          (e.progress === 100 && (e.score || 0) >= passingScore)
        );
      }).length || 0;

    const failedCourses =
      user.enrollments.filter((e) => {
        const isFinished = e.status === 'completed' || e.progress === 100;
        const hasScore = e.score !== null;
        const passingScore = e.course.lessons.find((l) => l.quiz)?.quiz?.passingScore || 70;
        return isFinished && hasScore && (e.score || 0) < passingScore;
      }).length || 0;

    // Active courses are those in progress but NOT failed yet
    const activeCourses = Math.max(0, totalCourses - completedCourses - failedCourses);

    return {
      user: {
        id: user.id,
        name: user.profile?.fullName || user.email.split('@')[0],
        email: user.email,
        avatarUrl: user.profile?.avatarUrl ?? null,
        role: user.role,
        jobTitle: user.profile?.jobTitle || 'Staff Member',
        managerId: user.managerId ?? null,
        managerName: user.manager ? (user.manager.profile?.fullName ?? user.manager.email) : null,
      },
      stats: {
        totalCourses,
        completedCourses,
        failedCourses,
        activeCourses,
      },
      enrollments: user.enrollments.map((e) => ({
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
  userId: string,
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
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, role: true },
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
      userId,
      target.role,
      data.role,
    );
    if (!decision.allowed) {
      logger.warn({
        msg: '[staff] Role change denied',
        actorId: session.user.id,
        targetUserId: userId,
        reason: decision.reason,
      });
      return { success: false, error: ROLE_CHANGE_DENIED_MESSAGES[decision.reason!] };
    }
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      // Bump sessionVersion on a role change so the target's live sessions are
      // invalidated on their next JWT decode — their new permission ceiling
      // takes effect immediately (F-059 kill-switch precedent).
      data: {
        role: data.role,
        // Stamp the role-join date so late-joiner deadline windows count from the
        // change, and bump sessionVersion so the new ceiling takes effect at once.
        ...(roleChanged ? { roleAssignedAt: new Date(), sessionVersion: { increment: 1 } } : {}),
      },
    });

    if (roleChanged) {
      await audit({
        action: 'staff.role.change',
        actorId: session.user.id,
        actorRole: session.user.role,
        organizationId: session.user.organizationId,
        targetType: 'user',
        targetId: userId,
        metadata: { fromRole: target.role, toRole: data.role },
        ...getClientContext(await headers()),
      });
      logger.info({
        msg: '[staff] Role changed',
        actorId: session.user.id,
        targetUserId: userId,
        fromRole: target.role,
        toRole: data.role,
      });

      // Live auto-enroll: the user now holds a new role, so enroll them in any
      // active role-target assignments for it. Never throws.
      await enrollUserForRoleTargets(userId, session.user.organizationId);
    }

    await prisma.profile.upsert({
      where: { id: userId },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: `${data.firstName} ${data.lastName}`.trim(),
        jobTitle: data.jobTitle,
      },
      create: {
        id: userId,
        email: user.email,
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: `${data.firstName} ${data.lastName}`.trim(),
        jobTitle: data.jobTitle,
      },
    });

    revalidatePath(`/dashboard/staff/${userId}`);
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
  if (!session?.user?.id || !isAdminRole(session.user.role) || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  // Restrict to the caller's own organization — never return users from other tenants.
  const admins = await prisma.user.findMany({
    where: {
      organizationId: session.user.organizationId,
      role: { in: [...ADMIN_ROLES] },
    },
    include: {
      profile: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return admins.map((admin) => ({
    id: admin.id,
    name: admin.profile?.fullName || admin.email,
    email: admin.email,
  }));
}

/**
 * Sets (or clears) the manager for a staff member. Enforces multi-tenant
 * isolation and the integrity rules: the manager must belong to the same
 * organization, must be admin-role, and cannot be the staff member themselves.
 */
export async function setStaffManager(
  staffId: string,
  managerId: string | null,
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
  const staff = await prisma.user.findUnique({
    where: { id: staffId },
    select: { organizationId: true },
  });
  if (!staff || staff.organizationId !== session.user.organizationId) {
    return { success: false, error: 'Forbidden' };
  }

  if (managerId !== null) {
    if (managerId === staffId) {
      return { success: false, error: 'A staff member cannot be their own manager' };
    }

    const manager = await prisma.user.findUnique({
      where: { id: managerId },
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
    await prisma.user.update({
      where: { id: staffId },
      data: { managerId },
    });

    logger.info({ msg: '[staff] Manager set', staffId, managerId, userId: session.user.id });

    // F-001: record the sensitive mutation on the authorized, successful path.
    await audit({
      action: 'staff.manager.set',
      actorId: session.user.id,
      actorRole: session.user.role,
      organizationId: session.user.organizationId,
      targetType: 'user',
      targetId: staffId,
      metadata: { managerId },
      ...getClientContext(await headers()),
    });

    revalidatePath(`/dashboard/staff/${staffId}`);
    revalidatePath('/dashboard/staff');
    return { success: true };
  } catch (error) {
    logger.error({ msg: '[staff] Failed to set manager', err: error, staffId });
    return { success: false, error: 'Failed to update manager' };
  }
}

/**
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
  staffUserId: string,
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
  const target = await prisma.user.findUnique({
    where: { id: staffUserId },
    select: { organizationId: true, email: true },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    return { success: [], alreadyEnrolled: [], newInvited: [], failed: [], error: 'Forbidden' };
  }

  // enrollUsers throws on the billing gate (and other hard failures). Normalize
  // that into this action's return shape so the calling modal surfaces the
  // specific message instead of falling back to a generic failed state.
  try {
    return await enrollUsers(courseId, [{ email: target.email }], assignmentSettings);
  } catch (err) {
    return {
      success: [],
      alreadyEnrolled: [],
      newInvited: [],
      failed: [staffUserId],
      error: err instanceof Error ? err.message : 'Failed to assign course',
    };
  }
}

export async function getEnrollmentQuizResult(enrollmentId: string) {
  const session = await auth();
  if (!session?.user?.id || !isAdminRole(session.user.role) || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        user: {
          include: {
            profile: true,
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
    if (enrollment.user.organizationId !== session.user.organizationId) {
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
      userName: enrollment.user.profile?.fullName || enrollment.user.email,
      organizationName: enrollment.user.organization?.name || undefined,
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

export async function removeStaff(userId: string) {
  try {
    const session = await auth();
    if (!session?.user?.email || !session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const admin = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        role: true,
        organizationId: true,
        email: true,
        organization: { select: { name: true } },
      },
    });

    if (!admin || !can(dbRoleToRoleKey(admin.role), 'user.delete') || !admin.organization) {
      throw new Error('Insufficient permissions or organization not found');
    }

    const staffUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        organizationId: true,
        email: true,
        profile: { select: { fullName: true } },
      },
    });

    if (!staffUser) {
      throw new Error('User not found');
    }

    if (staffUser.organizationId !== admin.organizationId) {
      throw new Error('User does not belong to your organization');
    }

    const staffName = staffUser.profile?.fullName || staffUser.email;

    // Disconnect the user from the organization. Bump sessionVersion in the
    // same write so any live session is invalidated on its next JWT decode
    // (F-059 kill-switch), locking the removed user out immediately.
    await prisma.user.update({
      where: { id: userId },
      data: { organizationId: null, sessionVersion: { increment: 1 } },
    });

    // F-001: record the sensitive mutation on the authorized, successful path.
    await audit({
      action: 'staff.remove',
      actorId: session.user.id,
      actorRole: admin.role,
      organizationId: admin.organizationId ?? undefined,
      targetType: 'user',
      targetId: userId,
      ...getClientContext(await headers()),
    });

    revalidatePath('/dashboard/staff');

    // Send notification emails (non-blocking for better UX)
    try {
      const { sendStaffRemovedEmail, sendStaffRemovalConfirmationEmail } =
        await import('@/lib/email');

      // Notify the worker
      await sendStaffRemovedEmail(staffUser.email, admin.organization.name);

      // Confirm to the admin
      await sendStaffRemovalConfirmationEmail(admin.email, staffName, admin.organization.name);
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
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  if (!admin || !can(dbRoleToRoleKey(admin.role), 'invite.delete')) {
    throw new Error('Insufficient permissions');
  }

  const invite = await prisma.invite.findUnique({
    where: { id: inviteId },
    select: { organizationId: true },
  });

  if (!invite) {
    throw new Error('Invite not found');
  }

  if (invite.organizationId !== admin.organizationId) {
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

    const admin = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, organizationId: true },
    });

    if (!admin || !can(dbRoleToRoleKey(admin.role), 'invite.edit') || !admin.organizationId) {
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

    if (invite.organizationId !== admin.organizationId) {
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
    await sendInviteEmail(
      invite.email,
      inviteLink,
      invite.organization?.name ?? 'your organization',
      invite.role,
    );

    logger.info({ msg: '[staff] Invite resent', inviteId, organizationId: admin.organizationId });

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
  staffUserId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    // Verify caller is an admin with an organization
    const admin = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        role: true,
        email: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    });

    if (!admin || !isAdminRole(admin.role) || !admin.organizationId) {
      return { success: false, error: 'Forbidden' };
    }

    // Verify the target staff belongs to the same organization
    const staffUser = await prisma.user.findUnique({
      where: { id: staffUserId },
      select: {
        organizationId: true,
        email: true,
        profile: { select: { fullName: true } },
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

    if (!staffUser) {
      return { success: false, error: 'Staff member not found' };
    }

    if (staffUser.organizationId !== admin.organizationId) {
      return { success: false, error: 'Forbidden — staff member not in your organization' };
    }

    const staffName = staffUser.profile?.fullName ?? staffUser.email.split('@')[0];
    const orgName = admin.organization?.name ?? 'Your Organization';

    // Build the report data
    const { generateUserActivityPdf } = await import('@/lib/pdf-reports');

    const enrollments: ActivityReportEnrollment[] = staffUser.enrollments.map((e) => ({
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
    const result = await sendUserActivityReportEmail(admin.email, staffName, orgName, pdfBuffer);

    if (!result.success) {
      return {
        success: false,
        error: 'PDF generated but email delivery failed. Please try again.',
      };
    }

    logger.info({
      msg: '[staff] Activity PDF report sent',
      staffUserId,
      adminEmail: admin.email,
    });

    return { success: true };
  } catch (error) {
    logger.error({ msg: '[staff] Failed to generate activity PDF', err: error });
    return { success: false, error: 'An unexpected error occurred. Please try again.' };
  }
}
