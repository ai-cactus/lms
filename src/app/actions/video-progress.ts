'use server';

import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { isQuizUnlocked } from '@/lib/video/gating';
import { logger } from '@/lib/logger';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';
import { AuthzError, requireActionSession } from '@/lib/auth-guard';
import { hasActiveBilling, TRAINING_ACCESS_PAUSED_MESSAGE } from '@/lib/billing';

const MFA_REQUIRED_MESSAGE = 'Please complete two-factor verification to continue.';

/**
 * Resolves the current session's ACTIVE membership id from either the admin or
 * worker session. Video access and progress are owned by the OrganizationUser,
 * not the identity, so this — not the identity id — is what every ownership
 * check below compares against. Returns null when neither session is active
 * (or the active session has no membership).
 */
async function currentOrganizationUserId(): Promise<string | null> {
  const { admin: a, worker: w } = await getPortalSessions();
  return a?.user?.organizationUserId ?? w?.user?.organizationUserId ?? null;
}

/**
 * Returns the same-origin playback URL for the given lesson's video.
 *
 * This is NOT the raw storage signed URL — the browser can't use that directly
 * (MinIO presigns against the internal Docker host `minio:9000`, which is both
 * unresolvable and plain http → Mixed Content). Instead we return the app proxy
 * `/api/video/[lessonId]`, which resolves + streams the bytes server-side over
 * same-origin HTTPS (mirrors the document preview proxy).
 *
 * The access check here is a fast pre-flight so the client gets a clear error;
 * the proxy route re-checks access as the real gatekeeper (defense in depth).
 *
 * Throws 'Unauthorized' when no session is present.
 * Throws 'Forbidden'    when the caller has no access.
 */
export async function getVideoPlaybackUrl(lessonId: string): Promise<string> {
  const organizationUserId = await currentOrganizationUserId();
  if (!organizationUserId) throw new Error('Unauthorized');

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      course: {
        include: {
          enrollments: {
            where: { organizationUserId },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!lesson) throw new Error('Lesson not found');

  const c = lesson.course;

  // Q-04: an archived course is cancelled, so nobody continues watching it —
  // not the enrolled learner, not the author. Thrown rather than returned to
  // match this action's existing refusal contract ('Unauthorized'/'Forbidden');
  // `/api/video/[lessonId]` refuses the same request independently.
  if (c.archivedAt) throw new Error('Forbidden');

  // Global published video courses are a shared catalog any signed-in user may
  // watch (e.g. an org admin previewing before assigning).
  const isGlobalCatalog = c.isGlobal && c.status === 'published' && c.type === 'video';
  const allowed =
    c.createdByOrgUserId === organizationUserId || c.enrollments.length > 0 || isGlobalCatalog;

  if (!allowed) throw new Error('Forbidden');

  return `/api/video/${lessonId}`;
}

/**
 * Persists the learner's video watch position and completion percentage.
 *
 * - Clamps watchedPct to [0, 100].
 * - When the learner crosses the watch gate (>= 95 %) and the enrollment
 *   status is still 'enrolled' or 'assigned', bumps it to 'lessons_complete'.
 * - Returns { unlocked: boolean } so the client can reveal the quiz button
 *   without a separate fetch.
 *
 * Guarded like the lesson-progress route (`/api/enrollments/[id]/progress`):
 * session, ownership, MFA step-up, billing, archive. The first two keep this
 * action's existing throw contract:
 *
 * Throws 'Unauthorized'        when no session is present.
 * Throws 'Enrollment not found' when the enrollment doesn't exist or belongs
 *                               to neither session.
 *
 * The policy refusals after them — MFA pending, billing inactive, course
 * archived — are RETURNED (`refusedReason`): the learner can be told about
 * them, and Next.js redacts thrown Server Action messages in production.
 */
export async function saveVideoProgress(
  enrollmentId: string,
  positionSeconds: number,
  watchedPct: number,
): Promise<{ unlocked: boolean; refusedReason?: string }> {
  const { admin, worker } = await getPortalSessions();
  if (!admin?.user?.organizationUserId && !worker?.user?.organizationUserId) {
    throw new Error('Unauthorized');
  }

  const enr = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      organizationUserId: true,
      status: true,
      progress: true,
      // Nested, so the archive query extension does not hide the row.
      course: { select: { archivedAt: true } },
      organizationUser: {
        select: {
          organization: {
            select: { subscription: { select: { status: true, pausedAt: true } } },
          },
        },
      },
    },
  });

  // Either portal may own the enrolment (one browser can hold both), so the
  // write is made as — and MFA-checked against — the session that owns it.
  const owner = enr
    ? [admin, worker].find(
        (session) => session?.user?.organizationUserId === enr.organizationUserId,
      )
    : undefined;
  if (!enr || !owner) {
    throw new Error('Enrollment not found');
  }

  // SEC-08 (F-012): MFA step-up at the data-access layer. proxy.ts only
  // redirects page navigations; a Server Action POST never passes through it.
  try {
    requireActionSession(owner);
  } catch (err) {
    if (!(err instanceof AuthzError)) throw err;
    logger.warn({
      msg: '[enrollment] Video progress blocked — session not authorised',
      enrollmentId,
      code: err.code,
    });
    return { unlocked: false, refusedReason: MFA_REQUIRED_MESSAGE };
  }

  // SEC-08: the portal layout blocks a lapsed organisation, but a direct call
  // to this action never renders the layout.
  if (!hasActiveBilling(enr.organizationUser.organization.subscription)) {
    logger.warn({
      msg: '[enrollment] Video progress blocked — organization lacks active billing',
      enrollmentId,
    });
    return { unlocked: false, refusedReason: TRAINING_ACCESS_PAUSED_MESSAGE };
  }

  // Q-04: watching on is the learner advancing through the course. Fail closed —
  // neither the position nor the watch-gate status bump below has run.
  if (enr.course.archivedAt) {
    logger.warn({
      msg: '[enrollment] Video progress blocked — course is archived',
      enrollmentId,
    });
    return { unlocked: false, refusedReason: ARCHIVED_COURSE_LEARNER_MESSAGE };
  }

  const pct = Math.max(0, Math.min(100, Math.round(watchedPct)));

  const bumpStatus =
    isQuizUnlocked(pct) && (enr.status === 'enrolled' || enr.status === 'assigned');

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      videoPositionSeconds: Math.round(positionSeconds),
      // A high-water mark, as on the lesson-progress route: the quiz submit
      // stamps 100, and re-watching a video afterwards must not pull it back.
      progress: Math.max(enr.progress, pct),
      lastActivityAt: new Date(),
      ...(bumpStatus ? { status: 'lessons_complete' } : {}),
    },
  });

  return { unlocked: isQuizUnlocked(pct) };
}
