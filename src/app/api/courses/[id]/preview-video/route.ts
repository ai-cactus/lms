import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { getSignedUrl } from '@/lib/storage';
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
async function currentOrganizationUserId(): Promise<{ organizationUserId: string | null } | null> {
  const [a, w] = await Promise.all([adminAuth(), workerAuth()]);
  const session = a?.user?.id ? a : w?.user?.id ? w : null;
  if (!session?.user?.id) return null;
  return { organizationUserId: session.user.organizationUserId };
}

const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await currentOrganizationUserId();
  if (!current) return new Response('Unauthorized', { status: 401 });

  const { id: courseId } = await params;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      previewVideoStorageUri: true,
      isGlobal: true,
      status: true,
      type: true,
      createdByOrgUserId: true,
    },
  });

  if (!course) return new Response('Not found', { status: 404 });

  const isGlobalCatalog =
    course.isGlobal && course.status === 'published' && course.type === 'video';
  const isCreator = current.organizationUserId
    ? course.createdByOrgUserId === current.organizationUserId
    : false;

  let isEnrolled = false;
  if (!isGlobalCatalog && !isCreator && current.organizationUserId) {
    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId, organizationUserId: current.organizationUserId },
      select: { id: true },
    });
    isEnrolled = !!enrollment;
  }

  const allowed = isGlobalCatalog || isCreator || isEnrolled;
  if (!allowed) return new Response('Forbidden', { status: 403 });

  if (!course.previewVideoStorageUri) {
    return new Response('No preview for this course', { status: 404 });
  }

  let signedUrl: string;
  try {
    signedUrl = await getSignedUrl(course.previewVideoStorageUri, 900);
  } catch (err) {
    logger.error({ msg: '[preview-video-proxy] failed to resolve url', err, courseId });
    return new Response('Failed to resolve video', { status: 500 });
  }

  // Forward the browser's Range header so storage returns 206 Partial Content.
  const range = request.headers.get('range');
  let upstream: Response;
  try {
    upstream = await fetch(signedUrl, { headers: range ? { Range: range } : {} });
  } catch (err) {
    logger.error({ msg: '[preview-video-proxy] failed to fetch from storage', err, courseId });
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
  headers.set('cache-control', 'private, no-store');

  return new Response(upstream.body, { status: upstream.status, headers });
}
