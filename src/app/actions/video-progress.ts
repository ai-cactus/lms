'use server';

import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { isQuizUnlocked } from '@/lib/video/gating';

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

  // Global published video courses are a shared catalog any signed-in user may
  // watch (e.g. an org admin previewing before assigning).
  const c = lesson.course;
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
 * Throws 'Unauthorized'        when no session is present.
 * Throws 'Enrollment not found' when the enrollment doesn't exist or belongs
 *                               to a different user.
 */
export async function saveVideoProgress(
  enrollmentId: string,
  positionSeconds: number,
  watchedPct: number,
): Promise<{ unlocked: boolean }> {
  const organizationUserId = await currentOrganizationUserId();
  if (!organizationUserId) throw new Error('Unauthorized');

  const enr = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { organizationUserId: true, status: true },
  });

  if (!enr || enr.organizationUserId !== organizationUserId) {
    throw new Error('Enrollment not found');
  }

  const pct = Math.max(0, Math.min(100, Math.round(watchedPct)));

  const bumpStatus =
    isQuizUnlocked(pct) && (enr.status === 'enrolled' || enr.status === 'assigned');

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      videoPositionSeconds: Math.round(positionSeconds),
      progress: pct,
      ...(bumpStatus ? { status: 'lessons_complete' } : {}),
    },
  });

  return { unlocked: isQuizUnlocked(pct) };
}
