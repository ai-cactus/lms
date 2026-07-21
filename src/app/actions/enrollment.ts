'use server';

import prisma from '@/lib/prisma';
import { isAdminRole, ALL_ROLES } from '@/lib/rbac/role-utils';
import { hasActiveBilling } from '@/lib/billing';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { notifyOrganizationAdmins } from './notifications';
import { QuizAttemptResult } from '@/types/quiz';
import { logger } from '@/lib/logger';
import type { StaffEntry } from '@/types/enrollment';
import { RenewalCycle, ReminderStage, UserRole } from '@/generated/prisma/enums';
import { REMINDER_STAGE_DEFAULTS, SWEEP_STAGES } from '@/lib/reminders/stages';
import { createEnrollmentForUser, type CreateEnrollmentContext } from '@/lib/enrollment/create';
import { enrollUserForRoleTargets } from '@/lib/enrollment/role-targets';

export interface AssignmentSettingsInput {
  scheduleAt?: string | Date | null;
  renewalCycle?: RenewalCycle;
  /** Admin-set hard deadline. Empty/omitted ⇒ computed server-side from a window. */
  dueAt?: string | Date | null;
  /** Override for the deadline window (days from start) when no explicit `dueAt`. */
  dueWindowDays?: number | null;
  /** Master switch for the deadline reminder ladder. Defaults to `true`. */
  remindersEnabled?: boolean;
  /** Per-stage cadence overrides; falls back to {@link REMINDER_STAGE_DEFAULTS}. */
  stages?: { stage: ReminderStage; offsetDays: number; enabled: boolean; channels?: string[] }[];
}

/**
 * The org's saved assignment settings for a course, as read back for the assign
 * page so re-opening it shows the live configuration (not factory defaults).
 */
export interface CourseAssignmentSettings {
  scheduleAt: Date | null;
  dueAt: Date | null;
  dueWindowDays: number | null;
  renewalCycle: RenewalCycle;
  remindersEnabled: boolean;
  /** Non-null when this assignment targets a whole role rather than individuals. */
  targetRole: UserRole | null;
  stages: { stage: ReminderStage; offsetDays: number; enabled: boolean; channels: string[] }[];
}

/**
 * Default `AssignmentReminderStage` rows — one per sweep stage seeded from the
 * canonical {@link REMINDER_STAGE_DEFAULTS}. Used when the caller does not supply
 * its own cadence. `INITIAL_LAUNCH` is intentionally excluded (it fires at
 * assignment time, never via the daily sweep).
 */
function defaultStageRows() {
  return SWEEP_STAGES.map((stage) => {
    const def = REMINDER_STAGE_DEFAULTS[stage];
    return { stage, offsetDays: def.offsetDays, enabled: true, channels: def.channels };
  });
}

interface StageRowInput {
  stage: ReminderStage;
  offsetDays: number;
  enabled: boolean;
  channels: string[];
}

interface UpsertCourseAssignmentParams {
  organizationId: string;
  courseId: string;
  assignedByAdminId: string;
  scheduleAt: Date | null;
  dueAt: Date | null;
  dueWindowDays: number | null;
  remindersEnabled: boolean;
  renewalCycle: RenewalCycle;
  stageRows: StageRowInput[];
  /**
   * Role this assignment targets. `undefined` leaves the existing value untouched
   * (an individual re-assignment must never clear a course's role targeting);
   * `null` explicitly clears it; a role value sets it.
   */
  targetRole?: UserRole | null;
}

/**
 * Create or update the org's single {@link CourseAssignment} for a course and
 * reconcile its per-stage reminder cadence. One assignment per
 * `(organizationId, courseId)`: reuse the most recent row so already-enrolled
 * workers keep firing off the same (now updated) schedule/ladder. Stage rows are
 * upserted on the `(assignmentId, stage)` unique key — never duplicated — and
 * stages outside the submitted set survive. Returns the assignment id.
 *
 * Shared by the individual-assignment path ({@link enrollUsers}) and the
 * role-target path ({@link assignCourseToRole}).
 */
async function upsertCourseAssignment(params: UpsertCourseAssignmentParams): Promise<string> {
  const { organizationId, courseId, targetRole } = params;

  const existing = await prisma.courseAssignment.findFirst({
    where: { organizationId, courseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (existing) {
    await prisma.courseAssignment.update({
      where: { id: existing.id },
      data: {
        assignedByAdminId: params.assignedByAdminId,
        scheduleAt: params.scheduleAt,
        dueAt: params.dueAt,
        dueWindowDays: params.dueWindowDays,
        remindersEnabled: params.remindersEnabled,
        renewalCycle: params.renewalCycle,
        ...(targetRole !== undefined ? { targetRole } : {}),
      },
    });

    for (const row of params.stageRows) {
      await prisma.assignmentReminderStage.upsert({
        where: { assignmentId_stage: { assignmentId: existing.id, stage: row.stage } },
        update: { offsetDays: row.offsetDays, enabled: row.enabled, channels: row.channels },
        create: { assignmentId: existing.id, ...row },
      });
    }

    logger.info({
      msg: '[enrollment] Existing course assignment updated',
      assignmentId: existing.id,
      organizationId,
      courseId,
      userId: params.assignedByAdminId,
    });
    return existing.id;
  }

  const created = await prisma.courseAssignment.create({
    data: {
      organizationId,
      courseId,
      assignedByAdminId: params.assignedByAdminId,
      scheduleAt: params.scheduleAt,
      dueAt: params.dueAt,
      dueWindowDays: params.dueWindowDays,
      remindersEnabled: params.remindersEnabled,
      renewalCycle: params.renewalCycle,
      ...(targetRole != null ? { targetRole } : {}),
      reminderStages: { create: params.stageRows },
    },
  });
  return created.id;
}

// Helper: resolve the active session from either auth instance
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

/**
 * Get all available users (workers) that can be enrolled in courses.
 * Used by Share Modal to show selectable users.
 */
export async function getAvailableUsers() {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Restrict to the caller's own organization — never return users from other tenants.
  const caller = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });
  if (!caller?.organizationId) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: { organizationId: caller.organizationId },
    include: {
      profile: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    fullName: user.profile?.fullName || user.email,
    role: user.role,
    avatarUrl: user.profile?.avatarUrl,
  }));
}

/**
 * Enroll users in a course using structured staff entries.
 * Each entry must include an email address and may optionally include
 * firstName, lastName, and role — all sourced from the CSV upload.
 *
 * - Existing users: enrolled immediately and notified.
 * - New users: account is created (with profile hydrated from CSV fields),
 *   a temporary password is issued, and a course invite email is sent.
 */
export async function enrollUsers(
  courseId: string,
  staffEntries: StaffEntry[],
  assignmentSettings?: AssignmentSettingsInput,
) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Verify course exists and the calling admin is allowed to enroll staff into it.
  const course = await prisma.course.findUnique({
    where: { id: courseId },
  });

  // Get organization info for new user creation and offering checks.
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      organization: {
        include: { subscription: { select: { status: true, pausedAt: true } } },
      },
    },
  });

  // Enrolling staff is an admin-only action. The session check above only
  // proves *someone* is logged in (a worker session would pass it); require
  // the admin role explicitly (mirrors assertOrgAdmin in offering.ts).
  if (!isAdminRole(currentUser?.role)) {
    throw new Error('Forbidden');
  }

  const isOwnCourse = course?.createdBy === session.user.id;

  // An org admin may also enroll staff into a global course that their
  // organization has explicitly offered (an OrgCourseOffering row exists).
  const organizationId = currentUser?.organizationId ?? null;
  const isOfferedGlobal =
    !isOwnCourse && course?.isGlobal === true && organizationId !== null
      ? (await prisma.orgCourseOffering.findUnique({
          where: { organizationId_courseId: { organizationId, courseId } },
          select: { id: true },
        })) !== null
      : false;

  // An org admin may assign a global published course straight from the
  // catalog without having offered it first — the offering is created below as
  // part of the assignment. (Non-global courses still require ownership.)
  const isAssignableCatalog = course?.isGlobal === true && course.status === 'published';

  if (!course || (!isOwnCourse && !isOfferedGlobal && !isAssignableCatalog)) {
    throw new Error('Course not found');
  }

  // A soft-deleted (inactive) global course must not accept NEW enrollments,
  // even if the org still has an existing offering row. Existing enrollments
  // are unaffected — they do not pass through this action.
  if (!isOwnCourse && course.isGlobal === true && course.status !== 'published') {
    throw new Error('Course not found');
  }

  // Billing gate (defense in depth): an org must have active billing to create
  // new enrollments. Placed after auth/existence checks so we never leak course
  // state, and before any assignment/enrollment writes.
  if (!hasActiveBilling(currentUser?.organization?.subscription)) {
    logger.warn({
      msg: '[enrollment] Course assignment blocked — organization lacks active billing',
      organizationId,
      userId: session.user.id,
    });
    throw new Error('Your organization needs an active subscription to assign courses.');
  }

  // Create a CourseAssignment batch to hold this assignment's schedule /
  // renewal / reminder settings. Workers in this call share these settings;
  // a later assignment creates a separate batch.
  const scheduleAt =
    assignmentSettings?.scheduleAt != null ? new Date(assignmentSettings.scheduleAt) : null;
  // An explicit admin-set deadline (empty string ⇒ omitted, computed per-user below).
  const assignmentDueAt = assignmentSettings?.dueAt ? new Date(assignmentSettings.dueAt) : null;
  let assignmentId: string | null = null;
  if (organizationId) {
    // Assigning a global catalog course also offers it to the org, so it shows
    // up in their offered courses and future assignments pass the offering
    // check above. Idempotent: re-assigning an already-offered course is a noop.
    if (course.isGlobal === true && !isOwnCourse) {
      await prisma.orgCourseOffering.upsert({
        where: { organizationId_courseId: { organizationId, courseId } },
        update: {},
        create: { organizationId, courseId, addedByAdminId: session.user.id },
      });
    }

    const stageRows = assignmentSettings?.stages?.length
      ? assignmentSettings.stages.map((s) => ({
          stage: s.stage,
          offsetDays: s.offsetDays,
          enabled: s.enabled,
          channels: s.channels ?? ['email', 'in_app'],
        }))
      : defaultStageRows();

    // Individual assignment: leave `targetRole` untouched (undefined) so re-adding
    // an individual worker never clears a course's role targeting.
    assignmentId = await upsertCourseAssignment({
      organizationId,
      courseId,
      assignedByAdminId: session.user.id,
      scheduleAt,
      dueAt: assignmentDueAt,
      dueWindowDays: assignmentSettings?.dueWindowDays ?? null,
      remindersEnabled: assignmentSettings?.remindersEnabled ?? true,
      renewalCycle: assignmentSettings?.renewalCycle ?? 'none',
      stageRows,
    });
  }

  const results = {
    success: [] as string[],
    alreadyEnrolled: [] as string[],
    newInvited: [] as string[],
    failed: [] as string[],
  };

  // Resolve the org's facility ONCE (not per-iteration). New CSV users are
  // attached to it; null if the org has no facility yet.
  const facilityId = organizationId
    ? ((
        await prisma.facility.findFirst({
          where: { organizationId },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

  const enrollmentContext: CreateEnrollmentContext = {
    courseId,
    courseTitle: course.title,
    organizationId,
    organizationName: currentUser?.organization?.name || 'Your Organization',
    facilityId,
    assignmentId,
    scheduleAt,
    assignmentDueAt,
    assignmentWindowDays: assignmentSettings?.dueWindowDays ?? null,
    enrolledByUserId: session.user.id,
  };

  // Brand-new accounts created here gain a role, so they must also pick up any
  // OTHER role-target assignments for that role in the org (live auto-enroll).
  const newlyInvitedUserIds: string[] = [];

  for (const entry of staffEntries) {
    const outcome = await createEnrollmentForUser(entry, enrollmentContext);
    switch (outcome.status) {
      case 'failed':
        results.failed.push(outcome.email);
        break;
      case 'alreadyEnrolled':
        results.alreadyEnrolled.push(outcome.email);
        break;
      case 'newInvited':
        results.newInvited.push(outcome.email);
        newlyInvitedUserIds.push(outcome.userId);
        break;
      case 'enrolled':
        results.success.push(outcome.email);
        break;
    }
  }

  if (organizationId) {
    for (const newUserId of newlyInvitedUserIds) {
      await enrollUserForRoleTargets(newUserId, organizationId);
    }
  }

  revalidatePath(`/dashboard/training/courses/${courseId}`);
  return results;
}

/**
 * Read back the caller's organization's existing {@link CourseAssignment} for a
 * course (its schedule, deadline, renewal cycle, reminder toggle, and per-stage
 * cadence) so the assign page can prefill instead of showing factory defaults.
 * Returns null when no assignment exists yet.
 *
 * Admin-only, and strictly scoped to the caller's own organization.
 */
export async function getCourseAssignmentSettings(
  courseId: string,
): Promise<CourseAssignmentSettings | null> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  if (!isAdminRole(currentUser?.role)) {
    throw new Error('Forbidden');
  }

  if (!currentUser?.organizationId) {
    return null;
  }

  // Scope strictly to the caller's org so an admin can never read another
  // tenant's assignment configuration for the same (possibly global) course.
  const assignment = await prisma.courseAssignment.findFirst({
    where: { organizationId: currentUser.organizationId, courseId },
    orderBy: { createdAt: 'desc' },
    include: { reminderStages: true },
  });

  if (!assignment) {
    return null;
  }

  return {
    scheduleAt: assignment.scheduleAt,
    dueAt: assignment.dueAt,
    dueWindowDays: assignment.dueWindowDays,
    renewalCycle: assignment.renewalCycle,
    remindersEnabled: assignment.remindersEnabled,
    targetRole: assignment.targetRole,
    stages: assignment.reminderStages.map((s) => ({
      stage: s.stage,
      offsetDays: s.offsetDays,
      enabled: s.enabled,
      channels: s.channels,
    })),
  };
}

/**
 * Assign a course to a whole ROLE. Creates/updates the org's single
 * {@link CourseAssignment} for the course with a non-null `targetRole`, then
 * enrolls every CURRENT holder of that role in the caller's org. Future holders
 * are auto-enrolled live by {@link enrollUserForRoleTargets} at each role-write
 * site, with the nightly sweep as a backstop.
 *
 * Admin-only, strictly scoped to the caller's own organization. Role-target
 * assignments never carry an absolute `dueAt` — the per-user deadline is always
 * `start + window` — so an explicit `dueAt` is rejected server-side.
 */
export async function assignCourseToRole(
  courseId: string,
  targetRole: UserRole,
  assignmentSettings?: Omit<AssignmentSettingsInput, 'dueAt'>,
) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!(ALL_ROLES as readonly string[]).includes(targetRole)) {
    throw new Error('Invalid role');
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      organization: {
        include: { subscription: { select: { status: true, pausedAt: true } } },
      },
    },
  });

  if (!isAdminRole(currentUser?.role)) {
    throw new Error('Forbidden');
  }

  const organizationId = currentUser?.organizationId ?? null;
  if (!organizationId) {
    throw new Error('Forbidden');
  }

  const isOwnCourse = course?.createdBy === session.user.id;
  const isOfferedGlobal =
    !isOwnCourse && course?.isGlobal === true
      ? (await prisma.orgCourseOffering.findUnique({
          where: { organizationId_courseId: { organizationId, courseId } },
          select: { id: true },
        })) !== null
      : false;
  const isAssignableCatalog = course?.isGlobal === true && course.status === 'published';

  if (!course || (!isOwnCourse && !isOfferedGlobal && !isAssignableCatalog)) {
    throw new Error('Course not found');
  }

  if (!isOwnCourse && course.isGlobal === true && course.status !== 'published') {
    throw new Error('Course not found');
  }

  if (!hasActiveBilling(currentUser?.organization?.subscription)) {
    logger.warn({
      msg: '[enrollment] Role assignment blocked — organization lacks active billing',
      organizationId,
      userId: session.user.id,
    });
    throw new Error('Your organization needs an active subscription to assign courses.');
  }

  const scheduleAt =
    assignmentSettings?.scheduleAt != null ? new Date(assignmentSettings.scheduleAt) : null;

  // Offer a global catalog course to the org as part of the assignment (idempotent).
  if (course.isGlobal === true && !isOwnCourse) {
    await prisma.orgCourseOffering.upsert({
      where: { organizationId_courseId: { organizationId, courseId } },
      update: {},
      create: { organizationId, courseId, addedByAdminId: session.user.id },
    });
  }

  const stageRows = assignmentSettings?.stages?.length
    ? assignmentSettings.stages.map((s) => ({
        stage: s.stage,
        offsetDays: s.offsetDays,
        enabled: s.enabled,
        channels: s.channels ?? ['email', 'in_app'],
      }))
    : defaultStageRows();

  const assignmentId = await upsertCourseAssignment({
    organizationId,
    courseId,
    assignedByAdminId: session.user.id,
    scheduleAt,
    // Role-target assignments never carry an absolute deadline.
    dueAt: null,
    dueWindowDays: assignmentSettings?.dueWindowDays ?? null,
    remindersEnabled: assignmentSettings?.remindersEnabled ?? true,
    renewalCycle: assignmentSettings?.renewalCycle ?? 'none',
    stageRows,
    targetRole,
  });

  logger.info({
    msg: '[enrollment] Course assigned to role',
    assignmentId,
    organizationId,
    courseId,
    targetRole,
    userId: session.user.id,
  });

  // Enroll every CURRENT holder of the role; their deadline window counts from
  // the assignment start (now, unless a schedule date is set).
  const holders = await prisma.user.findMany({
    where: { organizationId, role: targetRole },
    select: { id: true, email: true },
  });

  const enrollmentContext: CreateEnrollmentContext = {
    courseId,
    courseTitle: course.title,
    organizationId,
    organizationName: currentUser?.organization?.name || 'Your Organization',
    facilityId: null,
    assignmentId,
    scheduleAt,
    assignmentDueAt: null,
    assignmentWindowDays: assignmentSettings?.dueWindowDays ?? null,
    enrolledByUserId: session.user.id,
  };

  const results = { enrolled: 0, alreadyEnrolled: 0, failed: 0 };
  for (const holder of holders) {
    const outcome = await createEnrollmentForUser({ email: holder.email }, enrollmentContext);
    if (outcome.status === 'enrolled' || outcome.status === 'newInvited') results.enrolled += 1;
    else if (outcome.status === 'alreadyEnrolled') results.alreadyEnrolled += 1;
    else results.failed += 1;
  }

  logger.info({
    msg: '[enrollment] Role assignment enrolled current holders',
    courseId,
    targetRole,
    holderCount: holders.length,
    ...results,
  });

  revalidatePath(`/dashboard/training/courses/${courseId}`);
  return { assignmentId, targetRole, holderCount: holders.length, ...results };
}

/**
 * Count the current holders of each assignable role in the caller's org, so the
 * assign UI can show how many workers a role-target assignment will enroll.
 * Admin-only, scoped to the caller's own organization.
 */
export async function getRoleHolderCounts(): Promise<Record<string, number>> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  if (!isAdminRole(currentUser?.role)) {
    throw new Error('Forbidden');
  }
  if (!currentUser?.organizationId) {
    return {};
  }

  const grouped = await prisma.user.groupBy({
    by: ['role'],
    where: { organizationId: currentUser.organizationId },
    _count: { _all: true },
  });

  return Object.fromEntries(grouped.map((g) => [g.role, g._count._all]));
}

/**
 * Get enrollment details with quiz results.
 */
export async function getEnrollmentWithResults(enrollmentId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: {
        include: { profile: true, organization: true },
      },
      course: {
        include: {
          lessons: {
            include: {
              quiz: {
                include: {
                  questions: {
                    orderBy: { order: 'asc' },
                  },
                },
              },
            },
            orderBy: { order: 'asc' },
          },
        },
      },
      quizAttempts: {
        include: {
          quiz: {
            include: {
              questions: {
                orderBy: { order: 'asc' },
              },
            },
          },
        },
      },
    },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  const isEnrolledUser = enrollment.userId === session.user.id;
  const isCourseCreator = enrollment.course.createdBy === session.user.id;

  if (!isEnrolledUser && !isCourseCreator) {
    throw new Error('Access denied');
  }

  return enrollment;
}

/**
 * Submit a quiz attempt with answers.
 */
export async function submitQuizAttempt(
  enrollmentId: string,
  quizId: string,
  answers: { questionId: string; selectedAnswer: string }[],
  timeTaken?: number,
): Promise<QuizAttemptResult> {
  const [admin, worker] = await Promise.all([
    (await import('@/auth')).auth(),
    (await import('@/auth.worker')).auth(),
  ]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { course: true },
  });

  if (!enrollment || (enrollment.userId !== adminId && enrollment.userId !== workerId)) {
    throw new Error('Enrollment not found');
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: true },
  });

  if (!quiz) {
    throw new Error('Quiz not found');
  }

  let correctCount = 0;
  for (const answer of answers) {
    const question = quiz.questions.find((q) => q.id === answer.questionId);
    if (question && question.correctAnswer === answer.selectedAnswer) {
      correctCount++;
    }
  }

  const totalQuestions = quiz.questions.length;
  const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const passed = score >= quiz.passingScore;

  // Append-history: read the latest attempt for this enrollment+quiz.
  const existingAttempt = await prisma.quizAttempt.findFirst({
    where: { enrollmentId, quizId },
    orderBy: { completedAt: 'desc' },
  });

  if (existingAttempt) {
    await prisma.quizAttempt.update({
      where: { id: existingAttempt.id },
      data: {
        answers,
        score,
        timeTaken,
        completedAt: new Date(),
      },
    });
  } else {
    await prisma.quizAttempt.create({
      data: {
        enrollmentId,
        quizId,
        answers,
        score,
        timeTaken,
      },
    });
  }

  if (!passed) {
    const user = await prisma.user.findUnique({
      where: { id: enrollment.userId },
      include: { profile: true },
    });

    if (user && user.organizationId) {
      await notifyOrganizationAdmins(user.organizationId, {
        type: 'COURSE_FAILED',
        title: 'Quiz Failed',
        message: `${user.profile?.fullName || user.email} has failed the quiz for course: ${enrollment.course?.title || 'Unknown Course'}.`,
        linkUrl: `/dashboard/staff/${user.id}`,
        metadata: { userId: user.id, courseId: enrollment.courseId, score },
      });
    }
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'in_progress',
      score,
    },
  });

  logger.info({
    msg: '[enrollment] Quiz attempt submitted',
    enrollmentId,
    quizId,
    score,
    passed,
    correctCount,
    totalQuestions,
  });

  revalidatePath(`/dashboard/training`);

  return {
    score,
    passed,
    correctCount,
    totalQuestions,
  };
}

/**
 * Worker requests a retry on a failed course quiz.
 */
export async function requestCourseRetry(enrollmentId: string) {
  const [admin, worker] = await Promise.all([
    (await import('@/auth')).auth(),
    (await import('@/auth.worker')).auth(),
  ]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { include: { profile: true } },
      course: true,
    },
  });

  if (!enrollment || (enrollment.userId !== adminId && enrollment.userId !== workerId)) {
    throw new Error('Enrollment not found');
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'enrolled',
      score: null,
    },
  });

  logger.info({
    msg: '[enrollment] Course retry requested',
    enrollmentId,
    courseId: enrollment.courseId,
    userId: enrollment.userId,
  });

  if (enrollment.user.organizationId) {
    await notifyOrganizationAdmins(enrollment.user.organizationId, {
      type: 'COURSE_RETRY_REQUESTED',
      title: 'Course Retry Requested',
      message: `${enrollment.user.profile?.fullName || enrollment.user.email} has requested a retry for the course: ${enrollment.course.title}.`,
      linkUrl: `/dashboard/staff/${enrollment.user.id}`,
      metadata: { userId: enrollment.user.id, courseId: enrollment.courseId },
    });
  }

  revalidatePath(`/worker/trainings`);
  return { success: true };
}

/**
 * Remove a worker's assignment (enrollment) from a course.
 */
export async function removeWorkerAssignment(enrollmentId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      course: true,
      user: { include: { profile: true } },
    },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  // Ensure the user trying to remove the assignment is the course creator
  if (enrollment.course.createdBy !== session.user.id) {
    throw new Error('Access denied. Only the course creator can remove assignments.');
  }

  // Prevent removing if completed (optional, depending on business logic, but usually we allow removal or maybe block it)
  await prisma.enrollment.delete({
    where: { id: enrollmentId },
  });

  logger.info({
    msg: '[enrollment] Worker assignment removed',
    enrollmentId,
    courseId: enrollment.courseId,
    removedBy: session.user.id,
  });
  revalidatePath(`/dashboard/training/courses/${enrollment.courseId}`);

  return { success: true };
}
