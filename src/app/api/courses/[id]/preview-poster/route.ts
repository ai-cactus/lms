import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { isCourseOrganizationReviewer } from '@/lib/course/read-access';
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

interface MediaCaller {
  organizationUserId: string | null;
  organizationId: string | null;
  role: string | null;
}

/** Resolves null only when neither session is authenticated. */
async function currentCaller(): Promise<MediaCaller | null> {
  const { admin: a, worker: w } = await getPortalSessions();
  const session = a?.user?.id ? a : w?.user?.id ? w : null;
  if (!session?.user?.id) return null;
  return {
    organizationUserId: session.user.organizationUserId,
    organizationId: session.user.organizationId ?? null,
    role: session.user.role ?? null,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await currentCaller();
  if (!current) return new Response('Unauthorized', { status: 401 });

  const { id: courseId } = await params;

  const course = await resolveCoursePosterMeta(courseId, () =>
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        previewPosterStorageUri: true,
        isGlobal: true,
        status: true,
        type: true,
        organizationId: true,
      },
    }),
  );

  if (!course) return new Response('Not found', { status: 404 });

  const isGlobalCatalog =
    course.isGlobal && course.status === 'published' && course.type === 'video';
  // RISK-15: a manager of the organisation that owns the course, not its author.
  const isOrgReviewer = isCourseOrganizationReviewer(course, current);

  let isEnrolled = false;
  const organizationUserId = current.organizationUserId;
  if (!isGlobalCatalog && !isOrgReviewer && organizationUserId) {
    isEnrolled = await resolvePlaybackAuthz(organizationUserId, courseId, async () => {
      const enrollment = await prisma.enrollment.findFirst({
        where: { courseId, organizationUserId },
        select: { id: true },
      });
      return !!enrollment;
    });
  }

  if (!isGlobalCatalog && !isOrgReviewer && !isEnrolled) {
    return new Response('Forbidden', { status: 403 });
  }

  // Left uncached so a card stops 404ing as soon as the backfill lands a poster.
  const storageUri = course.previewPosterStorageUri;
  if (!storageUri) return new Response('No poster for this course', { status: 404 });

  return streamPoster(request, storageUri, { courseId });
}
