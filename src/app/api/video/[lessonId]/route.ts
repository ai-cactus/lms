import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { resolveVideoSource } from '@/lib/video';
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

async function currentUserId(): Promise<string | null> {
  const [a, w] = await Promise.all([adminAuth(), workerAuth()]);
  return a?.user?.id ?? w?.user?.id ?? null;
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

export async function GET(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const uid = await currentUserId();
  if (!uid) return new Response('Unauthorized', { status: 401 });

  const { lessonId } = await params;

  // Access: creator of the lesson's course OR enrolled in it (mirrors
  // getVideoPlaybackUrl in actions/video-progress.ts).
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      course: {
        include: { enrollments: { where: { userId: uid }, select: { id: true } } },
      },
    },
  });

  if (!lesson) return new Response('Not found', { status: 404 });

  // Global published video courses are a shared catalog any signed-in user may
  // watch (e.g. an org admin previewing before assigning).
  const c = lesson.course;
  const isGlobalCatalog = c.isGlobal && c.status === 'published' && c.type === 'video';
  const allowed = c.createdBy === uid || c.enrollments.length > 0 || isGlobalCatalog;
  if (!allowed) return new Response('Forbidden', { status: 403 });

  if (!lesson.videoStorageUri) return new Response('No video for this lesson', { status: 404 });

  let signedUrl: string;
  try {
    signedUrl = await resolveVideoSource(lesson.videoProvider ?? 'self').resolvePlaybackUrl(lesson);
  } catch (err) {
    logger.error({ msg: '[video-proxy] failed to resolve playback url', err, lessonId });
    return new Response('Failed to resolve video', { status: 500 });
  }

  // Forward the browser's Range header so storage returns 206 Partial Content.
  const range = request.headers.get('range');
  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, { headers: range ? { Range: range } : {} });
  } catch (err) {
    logger.error({ msg: '[video-proxy] failed to fetch from storage', err, lessonId });
    return new Response('Failed to fetch video from storage', { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Failed to fetch video from storage', { status: upstream.status });
  }

  const headers = new Headers();
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'video/mp4');
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  // Signed/proxied media is per-user; don't let shared caches store it.
  headers.set('cache-control', 'private, no-store');

  return new Response(upstream.body, { status: upstream.status, headers });
}
