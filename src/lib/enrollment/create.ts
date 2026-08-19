import prisma from '@/lib/prisma';
import { DEFAULT_SELF_SERVE_WORKER_ROLE } from '@/lib/rbac/role-utils';
import { logger, maskEmail } from '@/lib/logger';
import { createNotification } from '@/app/actions/notifications';
import { computeDueAt, resolveStartDate } from '@/lib/reminders/deadline';
import { resolveMemberFacilityId, resolveMemberFacilityIds } from '@/lib/facility/member-facility';
import type { StaffEntry } from '@/types/enrollment';
import type { UserRole } from '@/generated/prisma/enums';
import type { Invite } from '@/generated/prisma/client';

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
  /** Facility an invited worker is attached to; null falls back to the org's first. */
  facilityId: string | null;
  /** Parent {@link CourseAssignment} id; null when no assignment batch exists. */
  assignmentId: string | null;
  scheduleAt: Date | null;
  assignmentDueAt: Date | null;
  assignmentWindowDays: number | null;
  /** Actor (identity id) recorded on the structured enrollment log. */
  enrolledByUserId: string;
  /**
   * Defer the worker-facing side-effects — the COURSE_ASSIGNED notification and
   * the launch email — to the caller, so a multi-course caller emits ONE batched
   * notice instead of N. The enrollment row, the computed deadline and the
   * INITIAL_LAUNCH ReminderLog seed are unaffected and still written here.
   *
   * Only the `enrolled` branch defers: an `invited` address has no account to
   * batch against, so the `/join` invite email always sends inline.
   */
  deferWorkerNotification?: boolean;
}

/**
 * The worker-facing side-effects {@link createEnrollmentForUser} did not emit
 * because {@link CreateEnrollmentContext.deferWorkerNotification} was set. The
 * caller groups these (see `collectDeferredNotices`) into one notice per worker.
 */
export interface DeferredWorkerNotification {
  /** The membership the in-app notice addresses — notifications are per-org. */
  organizationUserId: string;
  userId: string;
  email: string;
  recipientName: string;
  courseId: string;
  courseTitle: string;
  organizationName: string;
  /** The deadline actually persisted on the enrollment row. */
  dueAt: Date;
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
  | {
      status: 'enrolled';
      email: string;
      userId: string;
      enrollmentId: string;
      /** Set only when the context deferred the notification/email to the caller. */
      deferred?: DeferredWorkerNotification;
    };

/** The identity projection this module reads — never the credential columns. */
interface PrefetchedUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
}

/**
 * Pre-fetched, per-email snapshot the batched path ({@link createEnrollmentsForUsers})
 * hands to {@link createEnrollmentForUser} so it can skip the five per-user read
 * queries it would otherwise issue one row at a time (`user.findUnique`,
 * `organizationUser.findFirst`, `invite.findFirst`, `enrollment.findFirst` and the
 * member's facility look-up). Every field must be the exact row those queries would
 * have returned for this email under `ctx.organizationId`; omit the argument
 * entirely to keep the original read-per-call behaviour (the sequential fallback).
 */
export interface EnrollmentPrefetch {
  /** The identity for this email, or null if none exists. */
  user: PrefetchedUser | null;
  /** The caller-org membership for that identity, or null when it has none. */
  membership: { id: string } | null;
  /** Whether an enrollment already exists for that membership on `ctx.courseId`. */
  alreadyEnrolled: boolean;
  /** The most recent outstanding pending invite for this email, or null. */
  existingInvite: Invite | null;
  /** The membership's facility, or null when it holds no active assignment. */
  memberFacilityId: string | null;
}

/**
 * Assign a course to one staff entry under an existing assignment context.
 *
 * For a pre-existing org member: write the enrollment with its computed deadline,
 * seed the `INITIAL_LAUNCH` reminder log, notify the worker in-app, and send the
 * launch email — the last two returned as a {@link DeferredWorkerNotification}
 * instead when {@link CreateEnrollmentContext.deferWorkerNotification} is set.
 * For an unknown or org-less email: send a `/join` invite and park
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
        select: { id: true, firstName: true, lastName: true, fullName: true },
      });

  // Tenancy is now structural: we only ever look for a membership in the
  // CALLER's organization, so an identity that also belongs to another org is
  // simply not found here and can never be enrolled cross-tenant.
  const membership = prefetch
    ? prefetch.membership
    : user && ctx.organizationId
      ? await prisma.organizationUser.findFirst({
          where: { userId: user.id, organizationId: ctx.organizationId, active: true },
          select: { id: true },
        })
      : null;

  // Unknown email, or an identity with no active membership in this org (e.g.
  // previously removed staff): do NOT create/enroll. Send a `/join` invite and
  // park the course on it — the enrollment is materialised when the invite is
  // accepted (see enrollInviteCourses). Unifies the assign flow with the
  // staff-invite flow; no premature accounts, no temporary passwords.
  if (!user || !membership) {
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

    // Every invite must name a facility. Prefer the caller's; otherwise fall
    // back to the org's first facility (onboarding guarantees at least one).
    const inviteFacilityId =
      ctx.facilityId ??
      (
        await prisma.facility.findFirst({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id;

    if (!inviteFacilityId) {
      logger.warn({
        msg: '[enrollment] Cannot invite for course assignment — organization has no facility',
        organizationId: ctx.organizationId,
        courseId: ctx.courseId,
      });
      return { status: 'failed', email: normalizedEmail };
    }

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
              facilityId: inviteFacilityId,
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

  // Existing org member: opportunistically backfill blank name fields from the
  // CSV without overwriting anything already set.
  if ((firstName || lastName) && !user.fullName && fullName) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: user.firstName ?? firstName ?? null,
        lastName: user.lastName ?? lastName ?? null,
        fullName,
      },
    });
  }

  const alreadyEnrolled = prefetch
    ? prefetch.alreadyEnrolled
    : (await prisma.enrollment.findFirst({
        where: { organizationUserId: membership.id, courseId: ctx.courseId },
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
      organizationUserId: membership.id,
      courseId: ctx.courseId,
      // The member's OWN facility, not ctx.facilityId — the latter is the invite
      // target for an address with no membership yet, which this branch is not.
      facilityId: prefetch
        ? prefetch.memberFacilityId
        : await resolveMemberFacilityId(prisma, membership.id),
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

  // This path is only reached for a pre-existing org member, so the Stage 1
  // launch email always sends here (invited addresses returned earlier with the
  // `/join` invite email instead) — unless the caller batches it.
  const recipientName = user.fullName || fullName || 'there';

  let deferred: DeferredWorkerNotification | undefined;
  if (ctx.deferWorkerNotification) {
    deferred = {
      organizationUserId: membership.id,
      userId: user.id,
      email: normalizedEmail,
      recipientName,
      courseId: ctx.courseId,
      courseTitle: ctx.courseTitle,
      organizationName: ctx.organizationName,
      dueAt: computedDueAt,
    };
  } else {
    await createNotification({
      organizationUserId: membership.id,
      type: 'COURSE_ASSIGNED',
      title: 'New Required Training Assigned',
      message: `You have been assigned a new course: ${ctx.courseTitle}`,
      linkUrl: `/worker/trainings`,
      metadata: { courseId: ctx.courseId },
    });

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

  return {
    status: 'enrolled',
    email: normalizedEmail,
    userId: user.id,
    enrollmentId: enrollment.id,
    ...(deferred ? { deferred } : {}),
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
 * but it (a) collapses the per-user identity / membership / enrollment / invite /
 * facility reads into batched look-ups up front and (b) runs the independent per-user
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

  // Batch read 1: resolve every candidate identity in one query.
  const users = await prisma.user.findMany({
    where: { email: { in: uniqueEmails } },
    select: { id: true, email: true, firstName: true, lastName: true, fullName: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  // Batch read 2: the caller-org memberships for those identities. Reading only
  // this org's rows keeps the batched path's tenancy guarantee identical to the
  // sequential one — an identity in another org simply resolves to no membership.
  const userIds = users.map((u) => u.id);
  const memberships =
    ctx.organizationId && userIds.length > 0
      ? await prisma.organizationUser.findMany({
          where: { userId: { in: userIds }, organizationId: ctx.organizationId, active: true },
          select: { id: true, userId: true },
        })
      : [];
  const membershipByUserId = new Map(memberships.map((m) => [m.userId, { id: m.id }]));
  const membershipIds = memberships.map((m) => m.id);

  // Batch reads 3, 4 & 5: existing enrollments for those memberships on this
  // course, outstanding pending invites for the batch, and each member's facility
  // — the remaining per-user reads createEnrollmentForUser would otherwise issue
  // one row at a time.
  const [existingEnrollments, pendingInvites, facilityByMembership] = await Promise.all([
    membershipIds.length > 0
      ? prisma.enrollment.findMany({
          where: { courseId: ctx.courseId, organizationUserId: { in: membershipIds } },
          select: { organizationUserId: true },
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
    resolveMemberFacilityIds(prisma, membershipIds),
  ]);

  const enrolledMembershipIds = new Set(existingEnrollments.map((e) => e.organizationUserId));
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
      const membership = user ? (membershipByUserId.get(user.id) ?? null) : null;
      const prefetch: EnrollmentPrefetch = {
        user,
        membership,
        alreadyEnrolled: membership ? enrolledMembershipIds.has(membership.id) : false,
        existingInvite: inviteByEmail.get(email) ?? null,
        memberFacilityId: membership ? (facilityByMembership.get(membership.id) ?? null) : null,
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
