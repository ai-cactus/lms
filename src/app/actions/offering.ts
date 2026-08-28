'use server';

import prisma from '@/lib/prisma';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath, unstable_cache } from 'next/cache';
import type { Role } from '@/types/next-auth';
import type { CourseWithStats } from '@/types/course';

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
function resolveOrg(sessionUser: { organizationId: string | null; role: Role }): string {
  if (!sessionUser.organizationId) {
    throw new Error('No organization');
  }
  if (!isAdminRole(sessionUser.role)) {
    throw new Error('Forbidden');
  }
  return sessionUser.organizationId;
}

// ---------------------------------------------------------------------------
// Global video catalog (tenant-independent, cached)
//   The published-global-video list is identical for every org between
//   publishes, so it's cached for 1h and tagged `video-catalog`. The per-org
//   "is this offered" flag is joined AFTER this read (see
//   listAvailableVideoCourses) so the cached payload never carries a tenant id
//   and one invalidation refreshes every org at once. Invalidate via
//   revalidateTag('video-catalog') at every global-video create / edit /
//   status-change site (see video-course.ts).
//
//   `hasPoster` is the one field NOT written by a server action: the poster is
//   produced by scripts/transcode-worker.ts, a detached child process with no
//   access to the Next cache, so it cannot revalidate the tag when it lands.
//   A course therefore stays `hasPoster: false` here for up to the 1h
//   `revalidate` after its transcode finishes. That is deliberate and safe —
//   the card falls back to its gradient, which is exactly what it shows for a
//   posterless course anyway, and suppressing the request is the whole point of
//   carrying the flag. Adding the field needs no cache-key change (the key is
//   the static ['global-video-catalog'] with no arguments) and no new
//   invalidation site: every existing revalidateTag('video-catalog') call
//   rebuilds the whole row including this field.
// ---------------------------------------------------------------------------
interface GlobalVideoCatalogRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  durationSeconds: number | null;
  questionCount: number;
  hasPoster: boolean;
  // Course-table fields, so the consolidated Courses list can be served from
  // the same cached read. Timestamps are ISO strings, not Dates: this payload
  // round-trips through the cache's serializer, which does not preserve Date.
  status: string;
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
        previewPosterStorageUri: true,
        status: true,
        thumbnail: true,
        duration: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { lessons: true } },
        lessons: {
          select: {
            videoDurationSeconds: true,
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
        hasPoster: Boolean(course.previewPosterStorageUri),
        status: course.status,
        thumbnail: course.thumbnail,
        durationMinutes: course.duration,
        lessonCount: course._count.lessons,
        createdAtIso: course.createdAt.toISOString(),
        updatedAtIso: course.updatedAt.toISOString(),
      };
    });
  },
  ['global-video-catalog'],
  { revalidate: 3600, tags: ['video-catalog'] },
);

// ---------------------------------------------------------------------------
// 1. listGlobalVideoCatalogCourses
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

  const organizationId = resolveOrg(session.user);

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
    };
  });
}

// ---------------------------------------------------------------------------
// 1a. listOfferedVideoCourses
//     Returns ONLY the global video courses this org has adopted (offered),
//     with the org's rebrand overrides + this org's staff enrollment count.
//     Powers the dedicated "Video Courses" tab on the Courses page.
// ---------------------------------------------------------------------------
export interface OfferedVideoCourseRow {
  courseId: string;
  offeringId: string;
  title: string; // customTitle ?? course.title
  baseTitle: string; // the global course's original title
  description: string | null;
  customTitle: string | null;
  customDescription: string | null;
  customIntro: string | null;
  durationSeconds: number | null;
  durationMinutes: number | null;
  questionCount: number;
  enrolledCount: number; // staff in THIS org enrolled in the course
}

export async function listOfferedVideoCourses(): Promise<OfferedVideoCourseRow[]> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const organizationId = resolveOrg(session.user);

  const offerings = await prisma.orgCourseOffering.findMany({
    // Exclude soft-deleted (inactive) courses so a deactivated course drops out
    // of the org's offered list, mirroring listAvailableVideoCourses.
    where: { organizationId, course: { status: 'published' } },
    orderBy: { createdAt: 'desc' },
    include: {
      course: {
        include: {
          lessons: {
            include: { quiz: { include: { _count: { select: { questions: true } } } } },
          },
        },
      },
    },
  });

  // Per-course enrollment counts scoped to THIS org's staff (one grouped query).
  const courseIds = offerings.map((o) => o.courseId);
  const counts = courseIds.length
    ? await prisma.enrollment.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds }, organizationUser: { organizationId } },
        _count: { _all: true },
      })
    : [];
  const countMap = new Map(counts.map((c) => [c.courseId, c._count._all]));

  return offerings.map((o) => {
    const firstLesson = o.course.lessons[0];
    return {
      courseId: o.courseId,
      offeringId: o.id,
      title: o.customTitle ?? o.course.title,
      baseTitle: o.course.title,
      description: o.customDescription ?? o.course.description,
      customTitle: o.customTitle,
      customDescription: o.customDescription,
      customIntro: o.customIntro,
      durationSeconds: firstLesson?.videoDurationSeconds ?? null,
      durationMinutes: o.course.duration ?? null,
      questionCount: firstLesson?.quiz?._count?.questions ?? 0,
      enrolledCount: countMap.get(o.courseId) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. offerCourseToOrg
//    Upsert an OrgCourseOffering keyed by [organizationId, courseId].
// ---------------------------------------------------------------------------
export interface OfferingOverrides {
  customTitle?: string;
  customDescription?: string;
  customIntro?: string;
}

export async function offerCourseToOrg(courseId: string, overrides?: OfferingOverrides) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const organizationId = resolveOrg(session.user);

  const course = await prisma.course.findFirst({
    where: { id: courseId, isGlobal: true, type: 'video', status: 'published' },
    select: { id: true },
  });
  if (!course) throw new Error('Course not found');

  const offering = await prisma.orgCourseOffering.upsert({
    where: { organizationId_courseId: { organizationId, courseId } },
    update: { ...(overrides ?? {}) },
    create: {
      organizationId,
      courseId,
      addedByAdminId: session.user.id,
      ...(overrides ?? {}),
    },
  });

  revalidatePath('/dashboard/courses');
  revalidatePath('/dashboard');

  return offering;
}

// ---------------------------------------------------------------------------
// 3. updateOffering
//    Update custom fields on an existing offering (must belong to caller's org).
// ---------------------------------------------------------------------------
export async function updateOffering(id: string, overrides: OfferingOverrides) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const organizationId = resolveOrg(session.user);

  const existing = await prisma.orgCourseOffering.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error('Forbidden');
  }

  const updated = await prisma.orgCourseOffering.update({
    where: { id },
    data: {
      customTitle: overrides.customTitle,
      customDescription: overrides.customDescription,
      customIntro: overrides.customIntro,
    },
  });

  revalidatePath('/dashboard/courses');
  revalidatePath('/dashboard');

  return updated;
}

// ---------------------------------------------------------------------------
// 4. withdrawOffering
//    Delete an offering (must belong to caller's org).
// ---------------------------------------------------------------------------
export async function withdrawOffering(id: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const organizationId = resolveOrg(session.user);

  const existing = await prisma.orgCourseOffering.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error('Forbidden');
  }

  await prisma.orgCourseOffering.delete({ where: { id } });

  revalidatePath('/dashboard/courses');
  revalidatePath('/dashboard');
}
