import type { Session } from 'next-auth';
import prisma from '@/lib/prisma';
import { rawPrisma } from '@/db/index';
import { getPortalSessions } from '@/lib/auth/portal-sessions';
import { isCourseOrganizationReviewer } from '@/lib/course/read-access';
import { canViewOrgCourses } from '@/lib/rbac/role-utils';
import { resolveCourseThumbnailMeta, resolvePlaybackAuthz } from '@/lib/video/playback-cache';
import { streamPoster } from '@/lib/video/poster-response';
import { resolveCourseThumbnailStorageUri } from '@/lib/video/thumbnail';

export const dynamic = 'force-dynamic';

/**
 * A video course's list thumbnail: the admin's custom image, else the preview
 * poster, else the course video's poster (src/lib/video/thumbnail.ts).
 *
 * Access mirrors /api/courses/[id]/preview-poster, plus one widening that
 * applies to this still image ONLY (Q-15, ruled yes): an org admin may see the
 * thumbnail of a retired (`inactive`) or archived global video course their
 * organization has offered or enrolled staff on, so its rows in lists and
 * history are not blank frames. The video and preview-video routes are
 * deliberately NOT widened. The /system back office has no portal session and
 * previews through /api/system/video-courses/[courseId]/thumbnail instead.
 */

interface ThumbnailCaller {
  organizationUserId: string | null;
  organizationId: string | null;
  role: string | null;
  /** The admin-portal session, when it is the one serving this request. */
  admin: Session | null;
}

/** Resolves null only when neither session is authenticated. */
async function currentCaller(): Promise<ThumbnailCaller | null> {
  const { admin: a, worker: w } = await getPortalSessions();
  const session = a?.user?.id ? a : w?.user?.id ? w : null;
  if (!session?.user?.id) return null;
  return {
    organizationUserId: session.user.organizationUserId,
    organizationId: session.user.organizationId ?? null,
    role: session.user.role ?? null,
    admin: session === a ? a : null,
  };
}

interface ThumbnailCourse {
  isGlobal: boolean;
  status: string;
  type: string;
  organizationId: string;
  archivedAt: Date | null;
}

/** The preview-poster rules, unchanged — they never admit an archived course. */
async function hasPosterAccess(
  course: ThumbnailCourse,
  courseId: string,
  caller: ThumbnailCaller,
): Promise<boolean> {
  if (course.archivedAt !== null) return false;
  if (course.isGlobal && course.status === 'published' && course.type === 'video') return true;
  // RISK-15: a manager of the organisation that owns the course, not its author.
  if (isCourseOrganizationReviewer(course, caller)) return true;
  const { organizationUserId } = caller;
  if (!organizationUserId) return false;

  return resolvePlaybackAuthz(organizationUserId, courseId, async () => {
    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId, organizationUserId },
      select: { id: true },
    });
    return !!enrollment;
  });
}

/**
 * Q-15: an org admin whose organization offered this global video course, or
 * enrolled anyone on it, keeps seeing its thumbnail after it is retired or
 * archived. `canViewOrgCourses` is the same "may see the organisation's
 * courses" gate the course lists use, so Finance and every worker role stay out.
 */
async function orgAdminMayViewRetiredThumbnail(
  course: ThumbnailCourse,
  courseId: string,
  admin: Session | null,
): Promise<boolean> {
  if (!course.isGlobal || course.type !== 'video') return false;
  const organizationId = admin?.user?.organizationId;
  if (!organizationId || !canViewOrgCourses(admin?.user?.role)) return false;

  const [offering, enrollment] = await Promise.all([
    prisma.orgCourseOffering.findUnique({
      where: { organizationId_courseId: { organizationId, courseId } },
      select: { id: true },
    }),
    prisma.enrollment.findFirst({
      where: { courseId, organizationUser: { organizationId } },
      select: { id: true },
    }),
  ]);
  return !!offering || !!enrollment;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const current = await currentCaller();
  if (!current) return new Response('Unauthorized', { status: 401 });

  const { id: courseId } = await params;

  // ⛔ `rawPrisma`, deliberately: the archive filter would 404 an archived
  // course before Q-15's org-admin rule could admit it. `hasPosterAccess`
  // refuses archived rows itself, so no other caller gains anything from this.
  const course = await resolveCourseThumbnailMeta(courseId, () =>
    rawPrisma.course.findUnique({
      where: { id: courseId },
      select: {
        thumbnailStorageUri: true,
        previewPosterStorageUri: true,
        isGlobal: true,
        status: true,
        type: true,
        organizationId: true,
        archivedAt: true,
        lessons: {
          orderBy: { order: 'asc' },
          take: 1,
          select: { videoPosterStorageUri: true },
        },
      },
    }),
  );

  if (!course) return new Response('Not found', { status: 404 });

  const allowed =
    (await hasPosterAccess(course, courseId, current)) ||
    (await orgAdminMayViewRetiredThumbnail(course, courseId, current.admin));

  if (!allowed) {
    // An archived course stays invisible to everyone else, exactly as it was
    // when the archive filter answered 404 for it.
    return course.archivedAt !== null
      ? new Response('Not found', { status: 404 })
      : new Response('Forbidden', { status: 403 });
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
