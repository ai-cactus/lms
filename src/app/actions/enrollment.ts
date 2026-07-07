'use server';

import prisma from '@/lib/prisma';
import { BCRYPT_COST } from '@/lib/bcrypt-config';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { createNotification, notifyOrganizationAdmins } from './notifications';
import { QuizAttemptResult } from '@/types/quiz';
import { logger } from '@/lib/logger';
import type { StaffEntry } from '@/types/enrollment';
import { RenewalCycle, ReminderStage } from '@/generated/prisma/enums';
import { REMINDER_STAGE_DEFAULTS, SWEEP_STAGES } from '@/lib/reminders/stages';
import { computeDueAt, resolveStartDate } from '@/lib/reminders/deadline';

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

  // Get all users within the caller's organization
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
    role: user.role || 'worker',
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
    include: { organization: true },
  });

  // Enrolling staff is an admin-only action. The session check above only
  // proves *someone* is logged in (a worker session would pass it); require
  // the admin role explicitly (mirrors assertOrgAdmin in offering.ts).
  if (currentUser?.role !== 'admin') {
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

    const assignment = await prisma.courseAssignment.create({
      data: {
        organizationId,
        courseId,
        assignedByAdminId: session.user.id,
        scheduleAt,
        dueAt: assignmentDueAt,
        dueWindowDays: assignmentSettings?.dueWindowDays ?? null,
        remindersEnabled: assignmentSettings?.remindersEnabled ?? true,
        renewalCycle: assignmentSettings?.renewalCycle ?? 'none',
        reminderStages: { create: stageRows },
      },
    });
    assignmentId = assignment.id;
  }

  const results = {
    success: [] as string[],
    alreadyEnrolled: [] as string[],
    newInvited: [] as string[],
    failed: [] as string[],
  };

  const bcrypt = await import('bcryptjs');
  const crypto = await import('crypto');
  const { sendCourseInviteEmail, sendCourseLaunchEmail } = await import('@/lib/email');

  for (const entry of staffEntries) {
    const normalizedEmail = entry.email.toLowerCase().trim();

    // Validate email format (should already be clean from the client, but
    // server-side validation is mandatory).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      results.failed.push(normalizedEmail);
      continue;
    }

    // Derive display name from CSV fields (used in emails and profile).
    const firstName = entry.firstName?.trim() || undefined;
    const lastName = entry.lastName?.trim() || undefined;
    const fullName =
      firstName && lastName ? `${firstName} ${lastName}` : (firstName ?? lastName ?? undefined);
    // Only allow 'admin' or 'worker'; default to 'worker' for safety.
    const userRole: 'admin' | 'worker' = entry.role === 'admin' ? 'admin' : 'worker';

    // Find existing user by email.
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { profile: true },
    });

    // If user not found, create a new account with the CSV-supplied details.
    if (!user) {
      try {
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(tempPassword, BCRYPT_COST);

        const newUser = await prisma.user.create({
          data: {
            email: normalizedEmail,
            password: hashedPassword,
            role: userRole,
            emailVerified: true,
            organizationId: currentUser?.organizationId || null,
            // Hydrate profile immediately so the worker's name is visible
            // throughout the app without requiring them to edit their profile.
            profile:
              firstName || lastName
                ? {
                    create: {
                      email: normalizedEmail,
                      firstName: firstName ?? null,
                      lastName: lastName ?? null,
                      fullName: fullName ?? null,
                    },
                  }
                : undefined,
          },
          include: { profile: true },
        });

        user = newUser;

        logger.info({
          msg: '[enrollment] New user created via CSV invite',
          userId: newUser.id,
          role: userRole,
          hasProfile: !!(firstName || lastName),
          courseId,
        });

        // Send invite email with temporary credentials.
        try {
          await sendCourseInviteEmail(
            normalizedEmail,
            tempPassword,
            course.title,
            currentUser?.organization?.name || 'Your Organization',
          );
          results.newInvited.push(normalizedEmail);
        } catch (emailErr) {
          logger.error({
            msg: '[enrollment] Failed to send invite email',
            userId: newUser.id,
            err: emailErr,
          });
          // Still mark as invited — user account was created successfully.
          results.newInvited.push(normalizedEmail);
        }
      } catch (createErr) {
        logger.error({
          msg: '[enrollment] Failed to create user',
          email: normalizedEmail,
          err: createErr,
        });
        results.failed.push(normalizedEmail);
        continue;
      }
    } else if (firstName || lastName) {
      // Existing user: opportunistically update profile name fields if the
      // CSV provided them and the profile fields are currently blank.
      const profile = user.profile;
      if (!profile?.fullName && fullName) {
        await prisma.profile.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            email: normalizedEmail,
            firstName: firstName ?? null,
            lastName: lastName ?? null,
            fullName: fullName ?? null,
          },
          update: {
            firstName: profile?.firstName ?? firstName ?? null,
            lastName: profile?.lastName ?? lastName ?? null,
            fullName: profile?.fullName ?? fullName ?? null,
          },
        });
      }
    }

    if (!user) continue;

    // Check if the user is already enrolled in this course.
    const existing = await prisma.enrollment.findFirst({
      where: { userId: user.id, courseId },
    });

    if (existing) {
      if (!results.newInvited.includes(normalizedEmail)) {
        results.alreadyEnrolled.push(normalizedEmail);
      }
      continue;
    }

    // Compute the effective deadline for this enrollment. An explicit
    // assignment `dueAt` wins; otherwise it's `start + window`, where the window
    // comes from the assignment, then the org default, then the system default.
    // `Organization.defaultDueWindowDays` does not exist in the schema, so the
    // org window is null and resolution falls through to the system default.
    const computedDueAt = computeDueAt({
      assignmentDueAt,
      assignmentWindowDays: assignmentSettings?.dueWindowDays ?? null,
      orgWindowDays: null,
      start: resolveStartDate(
        { scheduleAt },
        { accessAt: scheduleAt ?? null, startedAt: new Date() },
      ),
    });

    // Create the enrollment record.
    const enrollment = await prisma.enrollment.create({
      data: {
        userId: user.id,
        courseId,
        status: 'enrolled',
        progress: 0,
        assignmentId: assignmentId ?? undefined,
        accessAt: scheduleAt ?? undefined,
        dueAt: computedDueAt,
      },
    });

    // Stage 1 dedup: record the launch in the ladder so the daily sweep never
    // re-fires it. Never let a logging failure abort the enrollment (a P2002 on
    // re-run is benign — the stage is already recorded).
    try {
      await prisma.reminderLog.create({
        data: {
          enrollmentId: enrollment.id,
          stage: 'INITIAL_LAUNCH',
          channels: ['email', 'in_app'],
          targetDate: new Date(),
        },
      });
    } catch (logErr) {
      logger.warn({
        msg: '[enrollment] INITIAL_LAUNCH reminder log not written',
        enrollmentId: enrollment.id,
        err: logErr,
      });
    }

    // In-app notification for the worker (Stage 1, in-app channel).
    await createNotification({
      userId: user.id,
      type: 'COURSE_ASSIGNED',
      title: 'New Required Training Assigned',
      message: `You have been assigned a new course: ${course.title}`,
      linkUrl: `/worker/trainings`,
      metadata: { courseId },
    });

    // Send the Stage 1 launch email only to pre-existing users — new users
    // already received the invite email with their temporary credentials above
    // (sending this too would double-email them). The launch email is itself the
    // "New Required Training Assigned" notice, so it replaces the older generic
    // enrollment email for existing users.
    if (!results.newInvited.includes(normalizedEmail)) {
      const recipientName = user.profile?.fullName || fullName || 'there';
      const orgName = currentUser?.organization?.name || 'Your Organization';
      try {
        await sendCourseLaunchEmail(
          normalizedEmail,
          recipientName,
          course.title,
          orgName,
          computedDueAt,
        );
      } catch (emailErr) {
        logger.error({
          msg: '[enrollment] Failed to send course launch email',
          userId: user.id,
          err: emailErr,
        });
      }
    }

    if (!results.newInvited.includes(normalizedEmail)) {
      results.success.push(normalizedEmail);
    }

    logger.info({
      msg: '[enrollment] User enrolled in course',
      userId: user.id,
      courseId,
      enrolledBy: session.user.id,
    });
  }

  revalidatePath(`/dashboard/training/courses/${courseId}`);
  return results;
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

  // Find the enrollment
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
  // Let's just delete the enrollment
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
