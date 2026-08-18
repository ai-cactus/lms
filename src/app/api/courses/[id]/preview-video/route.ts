import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { getSignedUrl } from '@/lib/storage';
import {
  PREVIEW_VIDEO_MAX_AGE_SECONDS,
  applyVideoCacheHeaders,
  resolveCoursePreviewMeta,
  resolvePlaybackAuthz,
  resolveSignedPlaybackUrl,
} from '@/lib/video/playback-cache';
import { applyProxiedMediaHeaders } from '@/lib/video/proxy-headers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy for a global video course's PREVIEW video.
 *
 * Mirrors /api/video/[lessonId]: the browser can't use a storage signed URL
 * directly (MinIO presigns against the internal Docker host over http), so we
 * resolve the signed URL server-side and stream the bytes back over same-origin
 * HTTPS, forwarding Range headers for seeking.
 *
 * Access: a signed-in user may view a course's preview when the course is part
 * of the global published catalog (any org may browse it) OR they created it OR
 * they're enrolled in it. The course must actually have a preview video.
 */

/** Resolves null only when neither session is authenticated. */
async function currentUserId(): Promise<string | null> {
  const { admin: a, worker: w } = await getPortalSessions();
  return a?.user?.id ?? w?.user?.id ?? null;
}

/** True when a fetch rejected because the caller's connection went away. */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return new Response('Unauthorized', { status: 401 });

  const { id: courseId } = await params;

  // Cached without the caller's enrollments: the meta is per-course, so folding
  // a per-user field into it would make the entry unshareable across viewers.
  // Enrollment is resolved separately through resolvePlaybackAuthz.
  const course = await resolveCoursePreviewMeta(courseId, () =>
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        previewVideoStorageUri: true,
        isGlobal: true,
        status: true,
        type: true,
        createdBy: true,
      },
    }),
  );

  if (!course) return new Response('Not found', { status: 404 });

  const isGlobalCatalog =
    course.isGlobal && course.status === 'published' && course.type === 'video';
  const isCreator = course.createdBy === uid;

  let isEnrolled = false;
  if (!isGlobalCatalog && !isCreator) {
    isEnrolled = await resolvePlaybackAuthz(uid, courseId, async () => {
      const enrollment = await prisma.enrollment.findFirst({
        where: { courseId, userId: uid },
        select: { id: true },
      });
      return !!enrollment;
    });
  }

  const allowed = isGlobalCatalog || isCreator || isEnrolled;
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const storageUri = course.previewVideoStorageUri;
  if (!storageUri) {
    return new Response('No preview for this course', { status: 404 });
  }

  let signedUrl: string;
  try {
    signedUrl = await resolveSignedPlaybackUrl(storageUri, (expirySeconds) =>
      getSignedUrl(storageUri, expirySeconds),
    );
  } catch (err) {
    logger.error({ msg: '[preview-video-proxy] failed to resolve url', err, courseId });
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
    logger.error({ msg: '[preview-video-proxy] failed to fetch from storage', err, courseId });
    return new Response('Failed to fetch video from storage', { status: 502 });
  }

  // A conditional request that storage answers with "unchanged" is a success,
  // not an error — it is the whole point of forwarding the validators, and it
  // is what makes a returning viewer's reload cost a header exchange instead of
  // the entire file.
  if (upstream.status === 304) {
    const notModifiedHeaders = new Headers();
    for (const h of NOT_MODIFIED_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) notModifiedHeaders.set(h, v);
    }
    applyVideoCacheHeaders(notModifiedHeaders, PREVIEW_VIDEO_MAX_AGE_SECONDS);
    return new Response(null, { status: 304, headers: notModifiedHeaders });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Failed to fetch video from storage', { status: upstream.status });
  }

  const headers = new Headers();
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  applyProxiedMediaHeaders(headers, upstream.status, storageUri);
  applyVideoCacheHeaders(headers, PREVIEW_VIDEO_MAX_AGE_SECONDS);

  return new Response(upstream.body, { status: upstream.status, headers });
}
