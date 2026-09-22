import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { resolveCourseThumbnailMeta, resolvePlaybackAuthz } from '@/lib/video/playback-cache';
import { streamPoster } from '@/lib/video/poster-response';
import { resolveCourseThumbnailStorageUri } from '@/lib/video/thumbnail';

export const dynamic = 'force-dynamic';

/**
 * A video course's list thumbnail: the admin's custom image, else the preview
 * poster, else the course video's poster (src/lib/video/thumbnail.ts).
 *
 * Access mirrors /api/courses/[id]/preview-poster. The /system back office has
 * no portal session and previews through
 * /api/system/video-courses/[courseId]/thumbnail instead.
 */

/** Resolves null only when neither session is authenticated. */
async function currentOrganizationUserId(): Promise<{ organizationUserId: string | null } | null> {
  const { admin: a, worker: w } = await getPortalSessions();
  const session = a?.user?.id ? a : w?.user?.id ? w : null;
  if (!session?.user?.id) return null;
  return { organizationUserId: session.user.organizationUserId };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await currentOrganizationUserId();
  if (!current) return new Response('Unauthorized', { status: 401 });

  const { id: courseId } = await params;

  const course = await resolveCourseThumbnailMeta(courseId, () =>
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        thumbnailStorageUri: true,
        previewPosterStorageUri: true,
        isGlobal: true,
        status: true,
        type: true,
        createdByOrgUserId: true,
        lessons: {
          orderBy: { order: 'asc' },
          take: 1,
          select: { videoPosterStorageUri: true },
        },
      },
    }),
  );

  if (!course) return new Response('Not found', { status: 404 });

  const isGlobalCatalog =
    course.isGlobal && course.status === 'published' && course.type === 'video';
  const organizationUserId = current.organizationUserId;
  const isCreator = organizationUserId ? course.createdByOrgUserId === organizationUserId : false;

  let isEnrolled = false;
  if (!isGlobalCatalog && !isCreator && organizationUserId) {
    isEnrolled = await resolvePlaybackAuthz(organizationUserId, courseId, async () => {
      const enrollment = await prisma.enrollment.findFirst({
        where: { courseId, organizationUserId },
        select: { id: true },
      });
      return !!enrollment;
    });
  }

  if (!isGlobalCatalog && !isCreator && !isEnrolled) {
    return new Response('Forbidden', { status: 403 });
  }

  const storageUri = resolveCourseThumbnailStorageUri({
    type: course.type,
    thumbnailStorageUri: course.thumbnailStorageUri,
    previewPosterStorageUri: course.previewPosterStorageUri,
    firstLessonPosterStorageUri: course.lessons[0]?.videoPosterStorageUri,
  });
  if (!storageUri) return new Response('No thumbnail for this course', { status: 404 });

  return streamPoster(request, storageUri, { courseId });
}
