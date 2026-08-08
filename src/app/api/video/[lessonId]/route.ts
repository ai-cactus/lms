import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { resolveVideoSource } from '@/lib/video';
import {
  LESSON_VIDEO_MAX_AGE_SECONDS,
  applyVideoCacheHeaders,
  invalidateLessonPlaybackMeta,
  resolveLessonPlaybackMeta,
  resolvePlaybackAuthz,
  resolveSignedPlaybackUrl,
} from '@/lib/video/playback-cache';
import { applyProxiedMediaHeaders } from '@/lib/video/proxy-headers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Same-origin video proxy.
 *
 * The browser CANNOT use a storage signed URL directly:
 *  - MinIO presigns against the internal Docker host (http://minio:9000/…),
 *    which the browser can't resolve (NS_ERROR_UNKNOWN_HOST) and which is
 *    plain http → Mixed Content on an https page.
 *
 * So we mirror the document pattern (/api/documents/[versionId]/preview):
 * resolve the signed URL server-side (where the internal host DOES resolve),
 * then stream the bytes back over same-origin HTTPS. Range headers are
 * forwarded both ways so the <video> element can seek/stream (206 Partial).
 */

/** Resolves null only when neither session is authenticated. */
async function currentOrganizationUserId(): Promise<{ organizationUserId: string | null } | null> {
  const { admin: a, worker: w } = await getPortalSessions();
  const session = a?.user?.id ? a : w?.user?.id ? w : null;
  if (!session?.user?.id) return null;
  return { organizationUserId: session.user.organizationUserId };
}

/** True when a fetch rejected because the caller's connection went away. */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Persist an honest media status once storage confirms the object is gone, so
 * the system panel and learner UI stop advertising a video that can't play.
 * Idempotent: only the first encounter writes; DB failures are logged, never
 * fatal to the response.
 */
async function markLessonMediaMissing(lessonId: string): Promise<void> {
  // Drop the cached meta first: the object behind the cached `videoStorageUri`
  // is gone, so the next request must re-read the row (and pick up a repoint if
  // the transcode worker has since written one) rather than re-fetch a 404.
  invalidateLessonPlaybackMeta(lessonId);
  try {
    await prisma.lesson.updateMany({
      where: { id: lessonId, mediaStatus: { not: 'failed' } },
      data: { mediaStatus: 'failed' },
    });
  } catch (err) {
    logger.error({ msg: '[video] failed to persist missing media status', err, lessonId });
  }
}

// Headers worth forwarding from storage back to the browser so seeking,
// buffering and content typing all work correctly.
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
] as const;

// A 304 carries NO body and no entity headers — echoing `content-length` or
// `content-range` from upstream on one is a spec violation that makes clients
// (and undici) treat the response as truncated.
const NOT_MODIFIED_HEADERS = ['etag', 'last-modified'] as const;

// Conditional-request headers must reach storage or its validators can never
// fire. Chrome sends `If-Range` alongside `Range` when resuming from a
// partially-cached response, and `If-None-Match`/`If-Modified-Since` when it
// revalidates a stale entry — dropping them forces a full re-download.
const FORWARDED_REQUEST_HEADERS = [
  'Range',
  'If-Range',
  'If-None-Match',
  'If-Modified-Since',
] as const;

function forwardedRequestHeaders(request: Request): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) forwarded[name] = value;
  }
  return forwarded;
}

export async function GET(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const current = await currentOrganizationUserId();
  if (!current) return new Response('Unauthorized', { status: 401 });

  const { lessonId } = await params;

  // Access: creator of the lesson's course OR enrolled in it (mirrors
  // getVideoPlaybackUrl in actions/video-progress.ts).
  // Explicitly selected: `include: { course: true }` would pull every Course
  // scalar — including the AI-pipeline artifacts (rawCourseJson, rawQuizJson,
  // rawSlidesJson, …), hundreds of KB of JSON deserialised on every Range
  // request — none of which this route reads.
  const lesson = await resolveLessonPlaybackMeta(lessonId, () =>
    prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        videoStorageUri: true,
        videoProvider: true,
        course: {
          select: {
            id: true,
            isGlobal: true,
            status: true,
            type: true,
            createdByOrgUserId: true,
          },
        },
      },
    }),
  );

  if (!lesson) return new Response('Not found', { status: 404 });

  // Global published video courses are a shared catalog any signed-in user may
  // watch (e.g. an org admin previewing before assigning).
  const c = lesson.course;
  const isGlobalCatalog = c.isGlobal && c.status === 'published' && c.type === 'video';
  const isCreator = current.organizationUserId
    ? c.createdByOrgUserId === current.organizationUserId
    : false;

  let isEnrolled = false;
  const organizationUserId = current.organizationUserId;
  if (!isGlobalCatalog && !isCreator && organizationUserId) {
    isEnrolled = await resolvePlaybackAuthz(organizationUserId, c.id, async () => {
      const enrollment = await prisma.enrollment.findFirst({
        where: { courseId: c.id, organizationUserId },
        select: { id: true },
      });
      return !!enrollment;
    });
  }

  const allowed = isCreator || isEnrolled || isGlobalCatalog;
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const storageUri = lesson.videoStorageUri;
  if (!storageUri) return new Response('No video for this lesson', { status: 404 });

  let signedUrl: string;
  try {
    signedUrl = await resolveSignedPlaybackUrl(storageUri, (expirySeconds) =>
      resolveVideoSource(lesson.videoProvider ?? 'self').resolvePlaybackUrl(lesson, expirySeconds),
    );
  } catch (err) {
    logger.error({ msg: '[video-proxy] failed to resolve playback url', err, lessonId });
    return new Response('Failed to resolve video', { status: 500 });
  }

  // Range plus the conditional validators, so storage can answer 206 or 304.
  const upstreamRequestHeaders = forwardedRequestHeaders(request);
  let upstream: Response;
  try {
    // `signal` ties the upstream read to the browser's connection. The <video>
    // element cancels Range requests constantly (every seek, every buffer-full
    // backoff); without this the abandoned request keeps streaming from storage
    // into a ReadableStream nobody is reading.
    upstream = await fetch(signedUrl, {
      headers: upstreamRequestHeaders,
      signal: request.signal,
    });
  } catch (err) {
    // A client-cancelled Range is routine, not a failure — logging it would
    // flood the logs with one error per seek.
    if (isAbortError(err)) return new Response(null, { status: 499 });
    logger.error({ msg: '[video-proxy] failed to fetch from storage', err, lessonId });
    return new Response('Failed to fetch video from storage', { status: 502 });
  }

  // A conditional request that storage answers with "unchanged" is a success,
  // not an error — it is the whole point of forwarding the validators, and it
  // is what makes a returning learner's reload cost a header exchange instead
  // of the entire file.
  if (upstream.status === 304) {
    const notModifiedHeaders = new Headers();
    for (const h of NOT_MODIFIED_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) notModifiedHeaders.set(h, v);
    }
    applyVideoCacheHeaders(notModifiedHeaders, LESSON_VIDEO_MAX_AGE_SECONDS);
    return new Response(null, { status: 304, headers: notModifiedHeaders });
  }

  if (!upstream.ok && upstream.status !== 206) {
    // A 404 is definitive: the object is gone from storage, so flip the lesson's
    // status to stop the DB lying. Other statuses (5xx, 403, …) are transient
    // or config-level — log them but never persist a false "missing".
    if (upstream.status === 404) {
      await markLessonMediaMissing(lessonId);
      logger.error({
        msg: '[video] storage object missing — marked media unavailable',
        lessonId,
        status: upstream.status,
      });
    } else {
      logger.error({
        msg: '[video] transient storage error fetching video',
        lessonId,
        status: upstream.status,
      });
    }
    return new Response('Failed to fetch video from storage', { status: upstream.status });
  }

  const headers = new Headers();
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  applyProxiedMediaHeaders(headers, upstream.status, storageUri);
  applyVideoCacheHeaders(headers, LESSON_VIDEO_MAX_AGE_SECONDS);

  return new Response(upstream.body, { status: upstream.status, headers });
}
