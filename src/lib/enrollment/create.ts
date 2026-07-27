import prisma from '@/lib/prisma';
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
 * Outcome of enrolling one staff entry. `invited` = the email had no org account
 * (unknown, or a previously-removed org-less user) so no user/enrollment was
 * created — a `/join` invite was sent and the course parked on it, to be enrolled
 * when the invite is accepted; `enrolled` = a pre-existing org member newly
 * enrolled (received the launch email with the real due date).
 */
export type EnrollmentOutcome =
  | { status: 'failed'; email: string }
  | { status: 'alreadyEnrolled'; email: string }
  | { status: 'invited'; email: string }
  | { status: 'enrolled'; email: string; userId: string; enrollmentId: string };

/**
 * Assign a course to one staff entry under an existing assignment context.
 *
 * For a pre-existing org member: write the enrollment with its computed deadline,
 * seed the `INITIAL_LAUNCH` reminder log, notify the worker in-app, and send the
 * launch email. For an unknown or org-less email: send a `/join` invite and park
 * the course on it (materialised into an enrollment on accept) rather than
 * creating an account. Never throws for an individual entry — a failure is
 * reported via the returned {@link EnrollmentOutcome}.
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
  const crypto = await import('crypto');
  const { sendCourseInviteEmail, sendCourseLaunchEmail } = await import('@/lib/email');

  const user = await prisma.user.findUnique({
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

  // Unknown email, or an existing account with no org (e.g. previously removed
  // staff): do NOT create/enroll a user. Send a `/join` invite and park the
  // course on it — the enrollment is materialised when the invite is accepted
  // (see enrollInviteCourses). Unifies the assign flow with the staff-invite
  // flow; no premature accounts, no temporary passwords.
  if (!user || user.organizationId === null) {
    if (!ctx.organizationId) {
      // No org to attach an invite to — the standalone assign / wizard paths
      // always have one, so this only guards a misconfigured caller.
      logger.warn({
        msg: '[enrollment] Cannot invite for course assignment — no organization in context',
        email: maskEmail(normalizedEmail),
        courseId: ctx.courseId,
      });
      return { status: 'failed', email: normalizedEmail };
    }

    // CSV supplies a coarse "admin" / "worker" token. Map "admin" to the RBAC
    // successor `supervisor` (facility admin); everything else becomes the
    // default self-serve worker role.
    const inviteRole: UserRole =
      entry.role === 'admin' ? 'supervisor' : DEFAULT_SELF_SERVE_WORKER_ROLE;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    try {
      // Reuse the org's outstanding pending invite for this email (refreshing its
      // expiry and keeping its token) so a second course assignment adds to the
      // same invite rather than issuing a competing token; otherwise create one.
      const existingInvite = await prisma.invite.findFirst({
        where: { email: normalizedEmail, organizationId: ctx.organizationId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      });

      const invite = existingInvite
        ? await prisma.invite.update({
            where: { id: existingInvite.id },
            data: { expiresAt },
          })
        : await prisma.invite.create({
            data: {
              email: normalizedEmail,
              token: crypto.randomUUID(),
              organizationId: ctx.organizationId,
              role: inviteRole,
              expiresAt,
              invitedBy: ctx.enrolledByUserId,
              status: 'pending',
            },
          });

      await prisma.inviteCourseAssignment.upsert({
        where: { inviteId_courseId: { inviteId: invite.id, courseId: ctx.courseId } },
        update: {},
        create: { inviteId: invite.id, courseId: ctx.courseId },
      });

      logger.info({
        msg: '[enrollment] Course assignment parked on invite',
        inviteId: invite.id,
        courseId: ctx.courseId,
        reused: !!existingInvite,
        enrolledBy: ctx.enrolledByUserId,
      });

      try {
        // Same link shape as createInvites — NEXT_PUBLIC_APP_URL, no staging fallback.
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${invite.token}`;
        await sendCourseInviteEmail(
          normalizedEmail,
          inviteLink,
          ctx.courseTitle,
          ctx.organizationName,
        );
      } catch (emailErr) {
        // The invite exists; a failed email must not fail the whole assignment.
        logger.error({
          msg: '[enrollment] Failed to send course invite email',
          inviteId: invite.id,
          err: emailErr,
        });
      }

      return { status: 'invited', email: normalizedEmail };
    } catch (inviteErr) {
      logger.error({
        msg: '[enrollment] Failed to create course invite',
        email: maskEmail(normalizedEmail),
        err: inviteErr,
      });
      return { status: 'failed', email: normalizedEmail };
    }
  }

  // Existing org member: opportunistically backfill blank profile name fields
  // from the CSV without overwriting anything already set.
  if (firstName || lastName) {
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

  // This path is only reached for a pre-existing org member, so the Stage 1
  // launch email always sends here (invited addresses returned earlier with the
  // `/join` invite email instead).
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

  logger.info({
    msg: '[enrollment] User enrolled in course',
    userId: user.id,
    courseId: ctx.courseId,
    enrolledBy: ctx.enrolledByUserId,
  });

  return {
    status: 'enrolled',
    email: normalizedEmail,
    userId: user.id,
    enrollmentId: enrollment.id,
  };
}
