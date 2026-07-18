import prisma from '@/lib/prisma';
import { BCRYPT_COST } from '@/lib/bcrypt-config';
import { DEFAULT_SELF_SERVE_WORKER_ROLE } from '@/lib/rbac/role-utils';
import { logger, maskEmail } from '@/lib/logger';
import { createNotification } from '@/app/actions/notifications';
import { computeDueAt, resolveStartDate } from '@/lib/reminders/deadline';
import type { StaffEntry } from '@/types/enrollment';
import type { UserRole } from '@/generated/prisma/enums';

/**
 * Assignment-scoped context shared by every user enrolled in a single call.
 * Passed explicitly (no hidden state) so this helper is reusable by any caller —
 * the standalone assign flow, the course wizard, and the role-join auto-enroll
 * hook — without re-deriving the enclosing assignment.
 */
export interface CreateEnrollmentContext {
  courseId: string;
  courseTitle: string;
  /** Owning org for a newly created worker; null when the org is unknown. */
  organizationId: string | null;
  /** Display name used in invite / launch emails. */
  organizationName: string;
  /** Facility to attach a newly created worker to; null when the org has none. */
  facilityId: string | null;
  /** Parent {@link CourseAssignment} id; null when no assignment batch exists. */
  assignmentId: string | null;
  scheduleAt: Date | null;
  assignmentDueAt: Date | null;
  assignmentWindowDays: number | null;
  /** Actor recorded on the structured enrollment log. */
  enrolledByUserId: string;
}

/**
 * Outcome of enrolling one staff entry. `newInvited` = a brand-new account was
 * created (and received the invite email, so it is not double-emailed the launch
 * notice); `enrolled` = a pre-existing user newly enrolled (received the launch
 * email with the real due date).
 */
export type EnrollmentOutcome =
  | { status: 'failed'; email: string }
  | { status: 'alreadyEnrolled'; email: string }
  | { status: 'newInvited'; email: string; userId: string; enrollmentId: string }
  | { status: 'enrolled'; email: string; userId: string; enrollmentId: string };

/**
 * Create a single enrollment for one staff entry under an existing assignment
 * context: resolve or create the user, write the enrollment with its computed
 * deadline, seed the `INITIAL_LAUNCH` reminder log, notify the worker in-app, and
 * send the launch email (existing users only). Never throws for an individual
 * entry — a failure is reported via the returned {@link EnrollmentOutcome}.
 */
export async function createEnrollmentForUser(
  entry: StaffEntry,
  ctx: CreateEnrollmentContext,
): Promise<EnrollmentOutcome> {
  const normalizedEmail = entry.email.toLowerCase().trim();

  // Server-side validation is mandatory even when the client pre-validates.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { status: 'failed', email: normalizedEmail };
  }

  const firstName = entry.firstName?.trim() || undefined;
  const lastName = entry.lastName?.trim() || undefined;
  const fullName =
    firstName && lastName ? `${firstName} ${lastName}` : (firstName ?? lastName ?? undefined);
  // CSV supplies a coarse "admin" / "worker" token. Map "admin" to the RBAC
  // successor `supervisor` (facility admin); everything else becomes the default
  // self-serve worker role.
  const userRole: UserRole = entry.role === 'admin' ? 'supervisor' : DEFAULT_SELF_SERVE_WORKER_ROLE;

  const bcrypt = await import('bcryptjs');
  const crypto = await import('crypto');
  const { sendCourseInviteEmail, sendCourseLaunchEmail } = await import('@/lib/email');

  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { profile: true },
  });

  // Tenancy guard: an email that resolves to an existing user in a DIFFERENT
  // organization must never be enrolled by this org. Covers every caller of this
  // helper (standalone assign, wizard, role-join hook). Reported as a generic
  // failure; the cross-tenant detail stays in the log only.
  if (
    user &&
    ctx.organizationId &&
    user.organizationId &&
    user.organizationId !== ctx.organizationId
  ) {
    logger.warn({
      msg: '[enrollment] Cross-tenant enrollment blocked — user belongs to a different organization',
      email: maskEmail(normalizedEmail),
      callerOrganizationId: ctx.organizationId,
      userOrganizationId: user.organizationId,
      courseId: ctx.courseId,
    });
    return { status: 'failed', email: normalizedEmail };
  }

  let wasInvited = false;

  if (!user) {
    try {
      const tempPassword = crypto.randomBytes(8).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, BCRYPT_COST);

      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          role: userRole,
          emailVerified: true,
          organizationId: ctx.organizationId,
          facilityId: ctx.facilityId,
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
      wasInvited = true;

      logger.info({
        msg: '[enrollment] New user created via CSV invite',
        userId: user.id,
        role: userRole,
        hasProfile: !!(firstName || lastName),
        courseId: ctx.courseId,
      });

      try {
        await sendCourseInviteEmail(
          normalizedEmail,
          tempPassword,
          ctx.courseTitle,
          ctx.organizationName,
        );
      } catch (emailErr) {
        // The account exists; a failed invite email must not fail the enrollment.
        logger.error({
          msg: '[enrollment] Failed to send invite email',
          userId: user.id,
          err: emailErr,
        });
      }
    } catch (createErr) {
      logger.error({
        msg: '[enrollment] Failed to create user',
        email: maskEmail(normalizedEmail),
        err: createErr,
      });
      return { status: 'failed', email: normalizedEmail };
    }
  } else if (firstName || lastName) {
    // Existing user: opportunistically backfill blank profile name fields from
    // the CSV without overwriting anything already set.
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

  const existing = await prisma.enrollment.findFirst({
    where: { userId: user.id, courseId: ctx.courseId },
  });

  if (existing) {
    return { status: 'alreadyEnrolled', email: normalizedEmail };
  }

  // The effective deadline: an explicit assignment `dueAt` wins; otherwise
  // `start + window`, where the window falls through to the system default when
  // no org default exists (`Organization.defaultDueWindowDays` is not modeled).
  const computedDueAt = computeDueAt({
    assignmentDueAt: ctx.assignmentDueAt,
    assignmentWindowDays: ctx.assignmentWindowDays,
    orgWindowDays: null,
    start: resolveStartDate(
      { scheduleAt: ctx.scheduleAt },
      { accessAt: ctx.scheduleAt ?? null, startedAt: new Date() },
    ),
  });

  const enrollment = await prisma.enrollment.create({
    data: {
      userId: user.id,
      courseId: ctx.courseId,
      status: 'enrolled',
      progress: 0,
      assignmentId: ctx.assignmentId ?? undefined,
      accessAt: ctx.scheduleAt ?? undefined,
      dueAt: computedDueAt,
    },
  });

  // Stage 1 dedup: record the launch in the ladder so the daily sweep never
  // re-fires it. A logging failure must never abort the enrollment (a P2002 on
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

  await createNotification({
    userId: user.id,
    type: 'COURSE_ASSIGNED',
    title: 'New Required Training Assigned',
    message: `You have been assigned a new course: ${ctx.courseTitle}`,
    linkUrl: `/worker/trainings`,
    metadata: { courseId: ctx.courseId },
  });

  // Send the Stage 1 launch email only to pre-existing users — new users already
  // received the invite email with their temporary credentials, and the launch
  // email is itself the "New Required Training Assigned" notice.
  if (!wasInvited) {
    const recipientName = user.profile?.fullName || fullName || 'there';
    try {
      await sendCourseLaunchEmail(
        normalizedEmail,
        recipientName,
        ctx.courseTitle,
        ctx.organizationName,
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

  logger.info({
    msg: '[enrollment] User enrolled in course',
    userId: user.id,
    courseId: ctx.courseId,
    enrolledBy: ctx.enrolledByUserId,
  });

  return wasInvited
    ? { status: 'newInvited', email: normalizedEmail, userId: user.id, enrollmentId: enrollment.id }
    : { status: 'enrolled', email: normalizedEmail, userId: user.id, enrollmentId: enrollment.id };
}
