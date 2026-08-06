import prisma from '@/lib/prisma';
import { DEFAULT_SELF_SERVE_WORKER_ROLE } from '@/lib/rbac/role-utils';
import { logger, maskEmail } from '@/lib/logger';
import { createNotification } from '@/app/actions/notifications';
import { computeDueAt, resolveStartDate } from '@/lib/reminders/deadline';
import type { StaffEntry } from '@/types/enrollment';
import type { UserRole } from '@/generated/prisma/enums';
import type { Invite, Prisma } from '@/generated/prisma/client';

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
 * Pre-fetched, per-user snapshot the batched path ({@link createEnrollmentsForUsers})
 * hands to {@link createEnrollmentForUser} so it can skip the three per-user read
 * queries it would otherwise issue one row at a time (`user.findUnique`,
 * `enrollment.findFirst`, `invite.findFirst`). Every field must be the exact row
 * those queries would have returned for this email; omit the argument entirely to
 * keep the original read-per-call behaviour (the sequential fallback path).
 */
export interface EnrollmentPrefetch {
  /** The user for this email (with profile), or null if none exists. */
  user: Prisma.UserGetPayload<{ include: { profile: true } }> | null;
  /** Whether an enrollment already exists for this user on `ctx.courseId`. */
  alreadyEnrolled: boolean;
  /** The most recent outstanding pending invite for this email, or null. */
  existingInvite: Invite | null;
}

/**
 * Assign a course to one staff entry under an existing assignment context.
 *
 * For a pre-existing org member: write the enrollment with its computed deadline,
 * seed the `INITIAL_LAUNCH` reminder log, notify the worker in-app, and send the
 * launch email. For an unknown or org-less email: send a `/join` invite and park
 * the course on it (materialised into an enrollment on accept) rather than
 * creating an account. Never throws for an individual entry — a failure is
 * reported via the returned {@link EnrollmentOutcome}.
 *
 * When `prefetch` is supplied the three per-user read queries are served from that
 * snapshot instead of the database; the write/notification/email side-effects are
 * unchanged. Passing it never alters the outcome, only the number of reads.
 */
export async function createEnrollmentForUser(
  entry: StaffEntry,
  ctx: CreateEnrollmentContext,
  prefetch?: EnrollmentPrefetch,
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

  const user = prefetch
    ? prefetch.user
    : await prisma.user.findUnique({
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
      const existingInvite = prefetch
        ? prefetch.existingInvite
        : await prisma.invite.findFirst({
            where: {
              email: normalizedEmail,
              organizationId: ctx.organizationId,
              status: 'pending',
            },
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

  const alreadyEnrolled = prefetch
    ? prefetch.alreadyEnrolled
    : (await prisma.enrollment.findFirst({
        where: { userId: user.id, courseId: ctx.courseId },
      })) !== null;

  if (alreadyEnrolled) {
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

/**
 * Max number of distinct emails processed concurrently by
 * {@link createEnrollmentsForUsers}. Bounded so a large batch never fires
 * hundreds of enrollment writes / launch emails at once (each entry ends in a
 * blocking transactional-email network call).
 */
const ENROLLMENT_BATCH_CONCURRENCY = 10;

/**
 * Batched, behaviour-preserving counterpart to {@link createEnrollmentForUser},
 * gated behind the `ENROLLMENT_BATCH_ENABLED` kill-switch at the call sites.
 *
 * Equivalent to calling `createEnrollmentForUser` once per entry in array order,
 * but it (a) collapses the per-user `user` / `enrollment` / `invite` reads into
 * three batched look-ups up front and (b) runs the independent per-user
 * side-effects with bounded concurrency instead of awaiting each serially. It
 * chooses the *implementation*, never the outcome: seat-limit rejection, skip
 * logic, which users get enrolled/invited, and the emails sent are all identical
 * to the sequential path.
 *
 * Returns one {@link EnrollmentOutcome} per input entry, in input order. Emails in
 * `skipEmails` (already normalised — the seat-limit rejections) are force-failed
 * without any DB work, mirroring the caller's per-entry seat guard. Duplicate
 * emails within the batch are processed sequentially inside their own group, so a
 * repeat occurrence observes the first's writes exactly as the sequential loop
 * does. Partial-failure semantics are inherited unchanged from
 * `createEnrollmentForUser`: a committed enrollment is never rolled back by a
 * later reminder-log or email failure, and a hard failure (e.g. the in-app
 * notification throwing) aborts the run — no per-entry outcome is transactional.
 */
export async function createEnrollmentsForUsers(
  entries: StaffEntry[],
  ctx: CreateEnrollmentContext,
  skipEmails: ReadonlySet<string> = new Set(),
): Promise<EnrollmentOutcome[]> {
  const outcomes = new Array<EnrollmentOutcome>(entries.length);

  const pending: { index: number; entry: StaffEntry; email: string }[] = [];
  entries.forEach((entry, index) => {
    const email = entry.email.toLowerCase().trim();
    if (skipEmails.has(email)) {
      outcomes[index] = { status: 'failed', email };
    } else {
      pending.push({ index, entry, email });
    }
  });

  if (pending.length === 0) {
    return outcomes;
  }

  const uniqueEmails = [...new Set(pending.map((p) => p.email))];

  // Batch read 1: resolve every candidate user (with profile) in one query.
  const users = await prisma.user.findMany({
    where: { email: { in: uniqueEmails } },
    include: { profile: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  // Batch reads 2 & 3: existing enrollments for the resolved users on this course,
  // and outstanding pending invites for the batch — the two remaining per-user
  // reads createEnrollmentForUser would otherwise issue one row at a time.
  const userIds = users.map((u) => u.id);
  const [existingEnrollments, pendingInvites] = await Promise.all([
    userIds.length > 0
      ? prisma.enrollment.findMany({
          where: { courseId: ctx.courseId, userId: { in: userIds } },
          select: { userId: true },
        })
      : Promise.resolve([]),
    ctx.organizationId
      ? prisma.invite.findMany({
          where: {
            email: { in: uniqueEmails },
            organizationId: ctx.organizationId,
            status: 'pending',
          },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
  ]);

  const enrolledUserIds = new Set(existingEnrollments.map((e) => e.userId));
  // `orderBy createdAt desc` means the first invite seen per email is the most
  // recent — the exact row createEnrollmentForUser's `findFirst` would return.
  const inviteByEmail = new Map<string, Invite>();
  for (const invite of pendingInvites) {
    const key = invite.email.toLowerCase();
    if (!inviteByEmail.has(key)) {
      inviteByEmail.set(key, invite);
    }
  }

  // Group entries by email, preserving order, so duplicate emails run sequentially
  // within their group — identical to the sequential path.
  const groups = new Map<string, { index: number; entry: StaffEntry }[]>();
  for (const { index, entry, email } of pending) {
    const group = groups.get(email);
    if (group) group.push({ index, entry });
    else groups.set(email, [{ index, entry }]);
  }
  const groupList = [...groups.entries()];

  let cursor = 0;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (cursor < groupList.length && firstError === undefined) {
      const [email, items] = groupList[cursor++];
      const user = userByEmail.get(email) ?? null;
      const prefetch: EnrollmentPrefetch = {
        user,
        alreadyEnrolled: user ? enrolledUserIds.has(user.id) : false,
        existingInvite: inviteByEmail.get(email) ?? null,
      };
      try {
        for (let i = 0; i < items.length; i++) {
          const { index, entry } = items[i];
          // Only the first occurrence may trust the pre-fetch snapshot; a repeat
          // email re-reads live so it observes the first occurrence's writes.
          outcomes[index] =
            i === 0
              ? await createEnrollmentForUser(entry, ctx, prefetch)
              : await createEnrollmentForUser(entry, ctx);
        }
      } catch (err) {
        // Mirror the sequential path: a hard failure aborts the run. Record the
        // first error, stop pulling new groups, let in-flight groups settle, then
        // rethrow after the pool drains.
        if (firstError === undefined) firstError = err;
        return;
      }
    }
  }

  const workerCount = Math.min(ENROLLMENT_BATCH_CONCURRENCY, groupList.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstError !== undefined) {
    throw firstError;
  }

  return outcomes;
}
