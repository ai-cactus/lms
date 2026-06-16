'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';

// ---------------------------------------------------------------------------
// Session helper — mirrors the pattern in course.ts
// ---------------------------------------------------------------------------
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

// ---------------------------------------------------------------------------
// Org resolver — derives organizationId for the current user and asserts admin
// ---------------------------------------------------------------------------
async function resolveOrg(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, role: true },
  });
  if (!user?.organizationId) {
    throw new Error('No organization');
  }
  if (user.role !== 'admin') {
    throw new Error('Forbidden');
  }
  return user.organizationId;
}

// ---------------------------------------------------------------------------
// Return type for listAvailableVideoCourses
// ---------------------------------------------------------------------------
export interface VideoCourseAvailabilityRow {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  questionCount: number;
  isOffered: boolean;
  offeringId: string | null;
}

// ---------------------------------------------------------------------------
// 1. listAvailableVideoCourses
//    Returns all published global video courses with this org's adoption state.
// ---------------------------------------------------------------------------
export async function listAvailableVideoCourses(): Promise<VideoCourseAvailabilityRow[]> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const userId = session.user.id;
  const organizationId = await resolveOrg(userId);

  const courses = await prisma.course.findMany({
    where: { type: 'video', isGlobal: true, status: 'published' },
    orderBy: { createdAt: 'desc' },
    include: {
      lessons: {
        include: {
          quiz: {
            include: {
              _count: { select: { questions: true } },
            },
          },
        },
      },
      offerings: {
        where: { organizationId },
      },
    },
  });

  return courses.map((course) => {
    const firstLesson = course.lessons[0];
    const durationSeconds = firstLesson?.videoDurationSeconds ?? null;
    const questionCount = firstLesson?.quiz?._count?.questions ?? 0;

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      durationSeconds,
      questionCount,
      isOffered: course.offerings.length > 0,
      offeringId: course.offerings[0]?.id ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// 1b. listOfferedVideoCourses
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

  const userId = session.user.id;
  const organizationId = await resolveOrg(userId);

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
        where: { courseId: { in: courseIds }, user: { organizationId } },
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

  const userId = session.user.id;
  const organizationId = await resolveOrg(userId);

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
      addedByAdminId: userId,
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

  const userId = session.user.id;
  const organizationId = await resolveOrg(userId);

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

  const userId = session.user.id;
  const organizationId = await resolveOrg(userId);

  const existing = await prisma.orgCourseOffering.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== organizationId) {
    throw new Error('Forbidden');
  }

  await prisma.orgCourseOffering.delete({ where: { id } });

  revalidatePath('/dashboard/courses');
  revalidatePath('/dashboard');
}
