'use server';

import prisma from '@/lib/prisma';
import { dbRoleToRoleKey, isAdminRole } from '@/lib/rbac/role-utils';
import { can, type Permission } from '@/lib/rbac/permissions';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { unstable_cache } from 'next/cache';
import type { Role } from '@/types/next-auth';
import type { CourseWithStats } from '@/types/course';
import { hasActiveBilling } from '@/lib/billing';
import { logger } from '@/lib/logger';
import { getCourses } from './course';
import { buildCourseThumbnailUrl } from '@/lib/video/thumbnail';
import { VIDEO_CATALOG_TAG } from '@/lib/video/catalog-cache';

// ---------------------------------------------------------------------------
// Session helper — mirrors the pattern in course.ts
// ---------------------------------------------------------------------------
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

// ---------------------------------------------------------------------------
// Org resolver — derives the ACTIVE membership's organizationId and asserts
// admin from the session. role/organizationId are authoritative on the
// DB-revalidated session, so this needs no extra user query.
// ---------------------------------------------------------------------------
function resolveOrg(
  sessionUser: { organizationId: string | null; role: Role },
  permission: Permission,
): string {
  if (!sessionUser.organizationId) {
    throw new Error('No organization');
  }
  // The verb is named per call site rather than left implicit in the tier: an
  // `isAdminRole` check on its own admits every admin-tier role, including the
  // read-only ones (supervisor, finance, clinical_director) that hold no
  // `course.*` write verb.
  //
  // The tier check STAYS, composed with the verb rather than replaced by it:
  // `workerPermissions` grants every learner `course.read`, so gating the read
  // on the permission alone would open the admin catalog to the whole workforce.
  // Same reasoning as getCourseForOrgView in course.ts.
  if (!isAdminRole(sessionUser.role) || !can(dbRoleToRoleKey(sessionUser.role), permission)) {
    throw new Error('Forbidden');
  }
  return sessionUser.organizationId;
}

// ---------------------------------------------------------------------------
// Global video catalog (tenant-independent, cached)
//   The published-global-video list is identical for every org between
//   publishes, so it's cached for 1h and tagged `video-catalog`. Anything
//   tenant-specific — enrollment tallies, adoption state — is joined AFTER
//   this read (see listGlobalVideoCatalogCourses) so the cached payload never
//   carries a tenant id and one invalidation refreshes every org at once.
//   Invalidate via expireVideoCatalog() at every global-video create / edit /
//   status-change / thumbnail site (see video-course.ts and
//   src/lib/video/custom-thumbnail.ts).
//
//   `thumbnail` is the one field a server action does NOT always refresh: a
//   poster produced by scripts/transcode-worker.ts, a detached child process
//   with no access to the Next cache, can't revalidate the tag when it lands.
//   A course whose poster lands or changes after this read keeps its previous
//   `thumbnail` — null (the placeholder), or a URL whose `v` predates the new
//   still — for up to the 1h `revalidate`. Cosmetic and bounded: the route
//   itself always resolves the current still, only the browser cache key lags.
// ---------------------------------------------------------------------------
interface GlobalVideoCatalogRow {
  id: string;
  title: string;
  description: string | null;
  // Currently unread by the sole consumer (listGlobalVideoCatalogCourses):
  // these three served the removed catalog-grid card. Kept because dropping
  // them also means narrowing this cached read's Prisma `select` (the
  // `lessons` branch), which is a separate, behaviour-affecting change rather
  // than dead-code cleanup.
  category: string | null;
  durationSeconds: number | null;
  questionCount: number;
  // Course-table fields, so the consolidated Courses list can be served from
  // the same cached read. Timestamps are ISO strings, not Dates: this payload
  // round-trips through the cache's serializer, which does not preserve Date.
  status: string;
  /** Same-origin thumbnail route URL, or null for the placeholder. */
  thumbnail: string | null;
  durationMinutes: number | null;
  lessonCount: number;
  createdAtIso: string;
  updatedAtIso: string;
}

const getGlobalVideoCatalog = unstable_cache(
  async (): Promise<GlobalVideoCatalogRow[]> => {
    const courses = await prisma.course.findMany({
      where: { type: 'video', isGlobal: true, status: 'published' },
      // Upload order (oldest first) — the catalog reads chronologically.
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        thumbnailStorageUri: true,
        previewPosterStorageUri: true,
        status: true,
        type: true,
        duration: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { lessons: true } },
        // Only the course video — the first lesson by order — is read.
        lessons: {
          orderBy: { order: 'asc' },
          take: 1,
          select: {
            videoDurationSeconds: true,
            videoPosterStorageUri: true,
            updatedAt: true,
            quiz: { select: { _count: { select: { questions: true } } } },
          },
        },
      },
    });

    return courses.map((course) => {
      const firstLesson = course.lessons[0];
      return {
        id: course.id,
        title: course.title,
        description: course.description,
        category: course.category,
        durationSeconds: firstLesson?.videoDurationSeconds ?? null,
        questionCount: firstLesson?.quiz?._count?.questions ?? 0,
        status: course.status,
        thumbnail: buildCourseThumbnailUrl(course, firstLesson),
        durationMinutes: course.duration,
        lessonCount: course._count.lessons,
        createdAtIso: course.createdAt.toISOString(),
        updatedAtIso: course.updatedAt.toISOString(),
      };
    });
  },
  ['global-video-catalog'],
  { revalidate: 3600, tags: [VIDEO_CATALOG_TAG] },
);

// ---------------------------------------------------------------------------
// listGlobalVideoCatalogCourses
//     The same published global video catalog, projected into the Courses-list
//     row shape so it can be merged into the org's own course list.
//
//     Product ruling (2026-08-10, re-confirmed 2026-08-27): every organization
//     owns every video course from the moment it is created, so there is no
//     "available / adopt" step to surface. `OrgCourseOffering` survives as
//     internal bookkeeping — existing rows and their per-org custom titles are
//     untouched — but adoption is no longer a user-facing action.
//
//     Enrollment tallies are scoped to THIS org's staff, matching how
//     getCourses() counts adopted courses.
// ---------------------------------------------------------------------------
export async function listGlobalVideoCatalogCourses(): Promise<CourseWithStats[]> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const organizationId = resolveOrg(session.user, 'course.read');

  const catalog = await getGlobalVideoCatalog();
  if (!catalog.length) return [];

  const counts = await prisma.enrollment.groupBy({
    by: ['courseId', 'status'],
    where: {
      courseId: { in: catalog.map((c) => c.id) },
      organizationUser: { organizationId },
    },
    _count: { _all: true },
  });

  const tallies = new Map<string, { total: number; completed: number }>();
  for (const row of counts) {
    const entry = tallies.get(row.courseId) ?? { total: 0, completed: 0 };
    entry.total += row._count._all;
    if (row.status === 'completed' || row.status === 'attested') {
      entry.completed += row._count._all;
    }
    tallies.set(row.courseId, entry);
  }

  return catalog.map((course) => {
    const tally = tallies.get(course.id) ?? { total: 0, completed: 0 };
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      thumbnail: course.thumbnail,
      status: course.status,
      // Pinned by the catalog's own `where` clause, which selects video only.
      type: 'video',
      duration: course.durationMinutes,
      createdAt: new Date(course.createdAtIso),
      updatedAt: new Date(course.updatedAtIso),
      lessonsCount: course.lessonCount,
      enrollmentsCount: tally.total,
      completionRate: tally.total > 0 ? Math.round((tally.completed / tally.total) * 100) : 0,
      // The source document belongs to the publishing tenant and must never be
      // linkable from this one.
      sourceDocumentId: null,
      isGlobalCatalog: true,
      isOrgAuthored: false,
    };
  });
}

/**
 * Every course the caller may assign to staff — authored, adopted, AND the
 * global video catalogue.
 *
 * `getCourses()` alone returns authored courses plus offerings the org has
 * already adopted. That is narrower than what the server will actually accept:
 * `enrollUsers` assigns a global published course straight from the catalogue
 * and creates the offering as part of the assignment (`isAssignableCatalog`),
 * because video courses are owned by every organisation from creation — the
 * adoption step was removed as friction on 2026-08-10.
 *
 * The staff-profile assign modal called `getCourses()` and so showed an EMPTY
 * Video Courses tab to any org that had not already adopted a prebuilt course,
 * while `/dashboard/courses` listed those same courses because it unioned the
 * catalogue itself. Both surfaces now share this one function, so the two lists
 * cannot drift apart again.
 *
 * Lives here rather than in `course.ts` on purpose: `offering.ts` owns the
 * catalogue (and its `unstable_cache`), so importing it the other way round
 * would drag that machinery into every module that touches courses.
 *
 * Billing-gated to match the courses list: an org without an active
 * subscription sees only what it authored or already adopted. Assignment is
 * separately billing-gated in `enrollUsers`, so this never offers a course the
 * assign call would then refuse.
 */
export async function getAssignableCourses(): Promise<CourseWithStats[]> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const organizationId = session.user.organizationId;
  const organization = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { subscription: { select: { status: true, pausedAt: true } } },
      })
    : null;

  const [ownCourses, catalogCourses] = await Promise.all([
    getCourses(),
    hasActiveBilling(organization?.subscription)
      ? // Additive: a catalogue failure must degrade to the org's own courses
        // rather than leave the assign modal unusable — but it is a real fault
        // and is never swallowed silently.
        listGlobalVideoCatalogCourses().catch((err) => {
          logger.error({
            msg: '[course] Global video catalog lookup failed for assignment',
            err,
            organizationId,
          });
          return [] as CourseWithStats[];
        })
      : Promise.resolve<CourseWithStats[]>([]),
  ]);

  // Own and adopted rows win the de-dupe: they carry this org's enrolment
  // tallies and lineage, which a catalogue-only row deliberately does not.
  const seen = new Set(ownCourses.map((course) => course.id));
  return [...ownCourses, ...catalogCourses.filter((course) => !seen.has(course.id))];
}
