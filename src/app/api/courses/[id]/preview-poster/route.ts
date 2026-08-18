import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { resolveCoursePosterMeta, resolvePlaybackAuthz } from '@/lib/video/playback-cache';
import { streamPoster } from '@/lib/video/poster-response';

export const dynamic = 'force-dynamic';

/**
 * Still frame for a course's preview video — the catalog card thumbnail.
 *
 * This is the route that pays for itself: a 12-card catalog page used to mount
 * 12 `<video preload="metadata">` elements, i.e. 12 authenticated proxy hits
 * pulling megabytes of MP4 headers before the viewer clicked anything. Twelve
 * ~40 KB JPEGs replace that, and PR 4's meta cache means they mostly cost a map
 * lookup rather than 12 Postgres round trips.
 *
 * Access mirrors /api/courses/[id]/preview-video.
 */

/** Resolves null only when neither session is authenticated. */
async function currentUserId(): Promise<string | null> {
  const { admin: a, worker: w } = await getPortalSessions();
  return a?.user?.id ?? w?.user?.id ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUserId();
  if (!uid) return new Response('Unauthorized', { status: 401 });

  const { id: courseId } = await params;

  const course = await resolveCoursePosterMeta(courseId, () =>
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        previewPosterStorageUri: true,
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

  if (!isGlobalCatalog && !isCreator && !isEnrolled) {
    return new Response('Forbidden', { status: 403 });
  }

  // Left uncached so a card stops 404ing as soon as the backfill lands a poster.
  const storageUri = course.previewPosterStorageUri;
  if (!storageUri) return new Response('No poster for this course', { status: 404 });

  return streamPoster(request, storageUri, { courseId });
}
