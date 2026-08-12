import prisma from '@/lib/prisma';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { resolveLessonPosterMeta, resolvePlaybackAuthz } from '@/lib/video/playback-cache';
import { streamPoster } from '@/lib/video/poster-response';

export const dynamic = 'force-dynamic';

/**
 * Still frame for a lesson video, used as the `<video poster>` on the learn page.
 *
 * With a poster present the player paints instantly and pays nothing for it,
 * where previously the only way to show a first frame was to let the element
 * pull the MP4 header (~100–500 KB, since +faststart puts the moov atom first).
 *
 * Authorization is identical to /api/video/[lessonId] — a poster is a frame of
 * the video, so it must not be readable by anyone who couldn't watch it.
 */

/** Resolves null only when neither session is authenticated. */
async function currentOrganizationUserId(): Promise<{ organizationUserId: string | null } | null> {
  const { admin: a, worker: w } = await getPortalSessions();
  const session = a?.user?.id ? a : w?.user?.id ? w : null;
  if (!session?.user?.id) return null;
  return { organizationUserId: session.user.organizationUserId };
}

export async function GET(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const current = await currentOrganizationUserId();
  if (!current) return new Response('Unauthorized', { status: 401 });

  const { lessonId } = await params;

  const lesson = await resolveLessonPosterMeta(lessonId, () =>
    prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        videoPosterStorageUri: true,
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

  if (!isCreator && !isEnrolled && !isGlobalCatalog) {
    return new Response('Forbidden', { status: 403 });
  }

  // Posters are generated at transcode time, so assets predating that (or whose
  // extraction failed) simply have none. Consumers fall back to a placeholder,
  // and this 404 is deliberately left uncached so it stops the moment the
  // backfill fills the column in.
  const storageUri = lesson.videoPosterStorageUri;
  if (!storageUri) return new Response('No poster for this lesson', { status: 404 });

  return streamPoster(request, storageUri, { lessonId });
}
