'use server';

import prisma from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { dbRoleToRoleKey, WORKER_ROLES } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { hasActiveBilling } from '@/lib/billing';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { notifyOrganizationAdmins } from './notifications';
import { CourseWithStats, CourseWithRelations, courseDetailSelect } from '@/types/course';
import { QuizQuestion } from '@/types/quiz';
import type { StaffEntry } from '@/types/enrollment';
import { logger } from '@/lib/logger';
import { resolveMemberFacilityId, resolveMemberFacilityIds } from '@/lib/facility/member-facility';
import { resolveFacilityScope } from '@/lib/facility/scope';
import { forkCourse } from '@/lib/course/fork-course';
import { resolveOnCompletion } from '@/lib/reminders/sweep';
import { combineDateAndTime } from '@/lib/reminders/deadline';
import { enrollUsers } from './enrollment';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

// KursWithStats is now imported from '@/types/course'

export async function getCourses(): Promise<CourseWithStats[]> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  if (!session.user.organizationUserId) {
    throw new Error('No active organization membership');
  }

  // Org/membership are authoritative on the DB-revalidated session — no re-query.
  const organizationId = session.user.organizationId;
  const createdByOrgUserId = session.user.organizationUserId;

  // Course structure only — lesson/enrollment tallies come from grouped
  // aggregation below, not from materializing every enrollment row per course.
  const courseCardSelect = {
    id: true,
    title: true,
    description: true,
    thumbnail: true,
    status: true,
    type: true,
    duration: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { lessons: true } },
  } satisfies Prisma.CourseSelect;

  const [ownCourses, offerings] = await Promise.all([
    prisma.course.findMany({
      where: { createdByOrgUserId },
      select: {
        ...courseCardSelect,
        // Latest source-document lineage, so the list can offer "View Source
        // Document" only for courses that actually have one.
        versions: {
          select: { documentVersion: { select: { documentId: true } } },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    organizationId
      ? prisma.orgCourseOffering.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
          select: { course: { select: courseCardSelect } },
        })
      : Promise.resolve([]),
  ]);

  const adoptedCourses = offerings.map((o) => o.course);
  const adoptedCourseIds = adoptedCourses.map((c) => c.id);

  // Per-course enrollment totals + completed/attested tallies via grouped
  // aggregation (F-028 pattern). Own courses count ALL enrollments (unscoped,
  // matching the prior behavior); adopted courses count only THIS org's staff.
  const [ownCounts, adoptedCounts] = await Promise.all([
    prisma.enrollment.groupBy({
      by: ['courseId', 'status'],
      where: { course: { createdByOrgUserId } },
      _count: { _all: true },
    }),
    organizationId && adoptedCourseIds.length
      ? prisma.enrollment.groupBy({
          by: ['courseId', 'status'],
          where: {
            courseId: { in: adoptedCourseIds },
            organizationUser: { organizationId },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const toCountMap = (
    rows: { courseId: string; status: string; _count: { _all: number } }[],
  ): Map<string, { total: number; completed: number }> => {
    const map = new Map<string, { total: number; completed: number }>();
    for (const row of rows) {
      const entry = map.get(row.courseId) ?? { total: 0, completed: 0 };
      entry.total += row._count._all;
      if (row.status === 'completed' || row.status === 'attested') {
        entry.completed += row._count._all;
      }
      map.set(row.courseId, entry);
    }
    return map;
  };

  const ownCountMap = toCountMap(ownCounts);
  const adoptedCountMap = toCountMap(adoptedCounts);

  const toStats = (
    course: {
      id: string;
      title: string;
      description: string | null;
      thumbnail: string | null;
      status: string;
      type: string;
      duration: number | null;
      createdAt: Date;
      updatedAt: Date;
      _count: { lessons: number };
      versions?: { documentVersion: { documentId: string } }[];
    },
    counts: { total: number; completed: number },
  ): CourseWithStats => ({
    id: course.id,
    title: course.title,
    description: course.description,
    thumbnail: course.thumbnail,
    status: course.status,
    type: course.type,
    duration: course.duration,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    lessonsCount: course._count.lessons,
    enrollmentsCount: counts.total,
    // Adopted offerings deliberately resolve to null: their source document
    // belongs to the publishing org and must never be linked from this tenant.
    sourceDocumentId: course.versions?.[0]?.documentVersion.documentId ?? null,
    completionRate: counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0,
  });

  const own = ownCourses.map((course) =>
    toStats(course, ownCountMap.get(course.id) ?? { total: 0, completed: 0 }),
  );
  const adopted = adoptedCourses.map((course) =>
    toStats(course, adoptedCountMap.get(course.id) ?? { total: 0, completed: 0 }),
  );

  // De-dupe in case the admin both created and adopted the same course id.
  const seen = new Set(own.map((c) => c.id));
  return [...own, ...adopted.filter((c) => !seen.has(c.id))];
}

export async function getCourseById(courseId: string): Promise<CourseWithRelations> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: courseDetailSelect,
  });

  if (!course) {
    throw new Error('Course not found');
  }

  // Allow access if user is the creator OR is enrolled in the course
  const isCreator = course.creator.userId === session.user.id;
  const isEnrolled = course.enrollments.some((e) => e.organizationUser.userId === session.user.id);

  if (!isCreator && !isEnrolled) {
    throw new Error('Course not found');
  }

  // Only the creator or an org admin may receive the full enrolled-staff roster.
  // A non-privileged enrolled worker must never get other staff's enrollment PII
  // (email/role/name/certificate) back from this action — the worker page discards
  // it client-side, but a direct server-action call would otherwise leak it (IDOR).
  // `user.read` is the staff-roster permission (the Staff Management gate), so it
  // is what separates a manager who may legitimately see other people's records
  // from a learner who may only ever see their own.
  const isPrivileged = isCreator || can(dbRoleToRoleKey(session.user.role), 'user.read');
  if (isPrivileged) {
    return course;
  }

  return {
    ...course,
    enrollments: course.enrollments.filter((e) => e.organizationUser.userId === session.user.id),
  };
}

/**
 * Fetch a GLOBAL, published video course for an org admin to view, even when
 * the org hasn't enrolled/offered it yet (the browse → "View" flow from the
 * available-courses list).
 *
 * Access is allowed to any org admin since the global catalog is public to
 * orgs, but enrollments are scoped to the CALLER'S organization so one org can
 * never see another org's enrolled staff. The creator/enrolled path stays in
 * getCourseById — this is only used as a fallback for global browse.
 */
export async function getCourseForOrgView(courseId: string): Promise<CourseWithRelations> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Org is authoritative on the DB-revalidated session — no re-query.
  const organizationId = session.user.organizationId;
  if (!organizationId) {
    throw new Error('Course not found');
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, type: 'video', isGlobal: true, status: 'published' },
    select: {
      ...courseDetailSelect,
      // Scope enrolled staff to the caller's org — never leak other orgs' users.
      enrollments: {
        ...courseDetailSelect.enrollments,
        where: { organizationUser: { organizationId } },
      },
    },
  });

  if (!course) {
    throw new Error('Course not found');
  }

  return course;
}

export async function createCourse(data: { title: string; description?: string }) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!session.user.organizationUserId) {
    throw new Error('You must belong to an organization to create courses');
  }

  const course = await prisma.course.create({
    data: {
      title: data.title,
      description: data.description || null,
      createdByOrgUserId: session.user.organizationUserId,
    },
  });

  logger.info({ msg: '[course] Course created', courseId: course.id, userId: session.user.id });
  revalidatePath('/dashboard/training');
  return course;
}

export async function updateCourse(
  courseId: string,
  data: {
    title?: string;
    description?: string;
    thumbnail?: string;
    duration?: number;
  },
) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing || existing.createdByOrgUserId !== session.user.organizationUserId) {
    logger.warn({
      msg: '[course] updateCourse: not found or unauthorized',
      courseId,
      userId: session.user.id,
    });
    throw new Error('Course not found');
  }

  const course = await prisma.course.update({
    where: { id: courseId },
    data,
  });

  logger.info({
    msg: '[course] Course updated',
    courseId,
    userId: session.user.id,
    fields: Object.keys(data),
  });
  revalidatePath('/dashboard/training');
  revalidatePath(`/dashboard/training/${courseId}`);
  return course;
}

export async function publishCourse(courseId: string, opts?: { acknowledgeWarnings?: boolean }) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing || existing.createdByOrgUserId !== session.user.organizationUserId) {
    logger.warn({
      msg: '[course] publishCourse: not found or unauthorized',
      courseId,
      userId: session.user.id,
    });
    throw new Error('Course not found');
  }

  // Publish-review gate (F-051): a course flagged for review cannot be published
  // until the caller explicitly acknowledges the quality warnings.
  if (existing.reviewRequired && !opts?.acknowledgeWarnings) {
    logger.warn({
      msg: '[course] publishCourse blocked: review required',
      courseId,
      userId: session.user.id,
      warnings: existing.qualityWarnings.length,
    });
    return {
      success: false as const,
      error: 'This course has quality warnings and requires review before publishing.',
      warnings: existing.qualityWarnings,
    };
  }

  const course = await prisma.course.update({
    where: { id: courseId },
    data: {
      status: 'published',
      // Clear the gate once warnings have been acknowledged and published.
      ...(existing.reviewRequired ? { reviewRequired: false } : {}),
    },
  });

  if (existing.reviewRequired) {
    logger.info({
      msg: '[course] Published with warnings acknowledged',
      courseId,
      userId: session.user.id,
      warnings: existing.qualityWarnings,
    });
  } else {
    logger.info({ msg: '[course] Course published', courseId, userId: session.user.id });
  }
  revalidatePath('/dashboard/training');
  return course;
}

export async function deleteCourse(courseId: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing || existing.createdByOrgUserId !== session.user.organizationUserId) {
    logger.warn({
      msg: '[course] deleteCourse: not found or unauthorized',
      courseId,
      userId: session.user.id,
    });
    throw new Error('Course not found');
  }

  await prisma.course.delete({ where: { id: courseId } });

  logger.info({ msg: '[course] Course deleted', courseId, userId: session.user.id });
  revalidatePath('/dashboard/training');
  return { success: true };
}

/**
 * Deep-copies a course the caller's ORGANIZATION owns into a new draft. Scoped to
 * the org rather than the individual author so a course can be duplicated by any
 * permitted colleague, not just whoever created it.
 */
export async function duplicateCourse(courseId: string) {
  const session = await resolveSession();
  if (!session?.user?.id || !session.user.organizationUserId || !session.user.organizationId) {
    throw new Error('Unauthorized');
  }

  if (!can(dbRoleToRoleKey(session.user.role), 'course.create')) {
    logger.warn({
      msg: '[course] duplicateCourse denied — missing course.create',
      courseId,
      userId: session.user.id,
      role: session.user.role,
    });
    throw new Error('Insufficient permissions');
  }

  // Tenant isolation: a course outside the caller's org is reported as not found
  // so its existence is never leaked.
  const existing = await prisma.course.findFirst({
    where: { id: courseId, creator: { organizationId: session.user.organizationId } },
    select: { id: true },
  });
  if (!existing) {
    logger.warn({
      msg: '[course] duplicateCourse: not found or unauthorized',
      courseId,
      userId: session.user.id,
    });
    throw new Error('Course not found');
  }

  const fork = await forkCourse({
    sourceCourseId: courseId,
    targetOrganizationUserId: session.user.organizationUserId,
    titleStrategy: 'duplicate',
  });

  revalidatePath('/dashboard/training');
  return fork;
}

/**
 * Adopts a platform prebuilt course into the caller's organization as an
 * editable draft. A copy (not an offering pointer) so the org can tailor it
 * without touching the shared catalog entry.
 */
export async function addPrebuiltCourseToOrg(courseId: string) {
  const session = await resolveSession();
  if (!session?.user?.id || !session.user.organizationUserId) {
    throw new Error('Unauthorized');
  }

  if (!can(dbRoleToRoleKey(session.user.role), 'course.create')) {
    logger.warn({
      msg: '[course] addPrebuiltCourseToOrg denied — missing course.create',
      courseId,
      userId: session.user.id,
      role: session.user.role,
    });
    throw new Error('Insufficient permissions');
  }

  // Only the platform catalog is adoptable — this must never become a path to
  // copy another tenant's private course.
  const prebuilt = await prisma.course.findFirst({
    where: { id: courseId, isGlobal: true },
    select: { id: true },
  });
  if (!prebuilt) {
    logger.warn({
      msg: '[course] addPrebuiltCourseToOrg: not a prebuilt course',
      courseId,
      userId: session.user.id,
    });
    throw new Error('Course not found');
  }

  const fork = await forkCourse({
    sourceCourseId: courseId,
    targetOrganizationUserId: session.user.organizationUserId,
    titleStrategy: 'catalog',
  });

  revalidatePath('/dashboard/training');
  return fork;
}

export interface PrebuiltCourseRow {
  id: string;
  title: string;
  description: string | null;
  /** Estimated duration in minutes; null when the course does not declare one. */
  duration: number | null;
}

/** The platform prebuilt catalog any org member with `course.read` may browse. */
export async function getPrebuiltCourses(): Promise<PrebuiltCourseRow[]> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!can(dbRoleToRoleKey(session.user.role), 'course.read')) {
    logger.warn({
      msg: '[course] getPrebuiltCourses denied — missing course.read',
      userId: session.user.id,
      role: session.user.role,
    });
    throw new Error('Insufficient permissions');
  }

  return prisma.course.findMany({
    where: { isGlobal: true, status: 'published' },
    select: { id: true, title: true, description: true, duration: true },
    orderBy: { title: 'asc' },
  });
}

// Get dashboard data (combines courses list and stats to prevent duplicate queries)
/**
 * @param requestedFacilityId Narrows every enrollment-derived figure (staff
 *   assigned, average grade, per-course pass/fail, training coverage) to one
 *   facility. Re-validated here rather than trusted: an unknown or inaccessible
 *   id widens back to the whole organisation, so a facility-bound caller can
 *   never read a site they are not assigned to. Omit for the org-wide view.
 */
export async function getDashboardData(requestedFacilityId?: string | null) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const scope = await resolveFacilityScope(session, requestedFacilityId);
  const facilityId = scope.mode === 'single' ? scope.facility.id : null;
  // Spread into a `where` to leave the org-wide query shape byte-identical.
  const facilityFilter = facilityId ? { facilityId } : {};

  // F-028: avoid the unbounded `enrollments: true` materialization that pulled
  // every enrollment row (all columns) for every course on each dashboard load.
  // Counts and per-user coverage are now computed with grouped aggregation
  // queries, and only the score-bearing enrollments are read — as a narrow
  // { courseId, score, completedAt } projection — for the average / monthly /
  // pass-fail stats that genuinely need row-level scores.
  //
  // `organizationUserId` is null only for a prospective founder mid-onboarding
  // (no organization yet) — tolerate it with an empty dashboard rather than
  // throwing; the client-side OrganizationActivationModal handles that state.
  const createdByOrgUserId = session.user.organizationUserId;
  const organizationId = session.user.organizationId;

  const [coursesRaw, courseStatusCounts, userStatusCounts, scoredEnrollments] = await Promise.all([
    createdByOrgUserId
      ? prisma.course.findMany({
          where: { createdByOrgUserId },
          select: {
            id: true,
            title: true,
            description: true,
            thumbnail: true,
            status: true,
            type: true,
            duration: true,
            createdAt: true,
            updatedAt: true,
            lessons: { select: { quiz: { select: { passingScore: true } } } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
    // Per-course enrollment totals + completed/attested tallies.
    createdByOrgUserId
      ? prisma.enrollment.groupBy({
          by: ['courseId', 'status'],
          where: { course: { createdByOrgUserId }, ...facilityFilter },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    // Per-membership status tallies for training coverage + distinct staff assigned.
    createdByOrgUserId
      ? prisma.enrollment.groupBy({
          by: ['organizationUserId', 'status'],
          where: { course: { createdByOrgUserId }, ...facilityFilter },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    // Only scored enrollments, narrow projection — used for average grade,
    // monthly performance and per-course pass/fail distribution.
    createdByOrgUserId
      ? prisma.enrollment.findMany({
          where: { course: { createdByOrgUserId }, score: { not: null }, ...facilityFilter },
          select: { courseId: true, score: true, completedAt: true },
        })
      : Promise.resolve([]),
  ]);

  // Get total staff (workers) in organization to ensure accurate coverage base
  let totalOrgStaff = 0;
  if (organizationId) {
    totalOrgStaff = await prisma.organizationUser.count({
      where: {
        organizationId,
        active: true,
        role: { in: [...WORKER_ROLES] },
        // Under facility scope the coverage base is that site's roster, so a
        // worker at another facility never dilutes its completion percentages.
        ...(facilityId ? { facilities: { some: { facilityId, active: true } } } : {}),
      },
    });
  }

  // Per-course enrollment totals and completed/attested tallies (from groupBy).
  const perCourseCounts = new Map<string, { total: number; completed: number }>();
  for (const row of courseStatusCounts) {
    const entry = perCourseCounts.get(row.courseId) ?? { total: 0, completed: 0 };
    entry.total += row._count._all;
    if (row.status === 'completed' || row.status === 'attested') {
      entry.completed += row._count._all;
    }
    perCourseCounts.set(row.courseId, entry);
  }

  const courses: CourseWithStats[] = coursesRaw.map((course) => {
    const counts = perCourseCounts.get(course.id) ?? { total: 0, completed: 0 };
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      thumbnail: course.thumbnail,
      status: course.status,
      type: course.type,
      duration: course.duration,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      lessonsCount: course.lessons.length,
      enrollmentsCount: counts.total,
      completionRate: counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0,
    };
  });

  // Group scored enrollments by course for the per-course performance stats.
  const scoresByCourse = new Map<string, number[]>();
  for (const e of scoredEnrollments) {
    const arr = scoresByCourse.get(e.courseId) ?? [];
    arr.push(e.score ?? 0);
    scoresByCourse.set(e.courseId, arr);
  }

  const totalCourses = coursesRaw.length;
  const averageScore =
    scoredEnrollments.length > 0
      ? Math.round(
          scoredEnrollments.reduce((sum, e) => sum + (e.score || 0), 0) / scoredEnrollments.length,
        )
      : 0;

  // Calculate monthly performance (average score per month for last 12 months)
  const monthlyPerformance = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (11 - i));
    return {
      month: d.toLocaleString('default', { month: 'short' }),
      monthIdx: d.getMonth(),
      year: d.getFullYear(),
    };
  }).map(({ month, monthIdx, year }) => {
    const inMonth = scoredEnrollments.filter((e) => {
      if (!e.completedAt) return false;
      const c = new Date(e.completedAt);
      return c.getMonth() === monthIdx && c.getFullYear() === year;
    });

    const avg =
      inMonth.length > 0
        ? Math.round(inMonth.reduce((sum, e) => sum + (e.score || 0), 0) / inMonth.length)
        : 0;

    return { month, value: avg };
  });

  // Calculate Course Performance (Scores vs Courses)
  const coursePerformance = coursesRaw.map((course) => {
    const quiz = course.lessons.find((l) => l.quiz)?.quiz;
    const passingScore = quiz?.passingScore || 70;

    // Scores of enrollments that have been graded for this course.
    const validScores = scoresByCourse.get(course.id) ?? [];

    const passCount = validScores.filter((score) => score >= passingScore).length;
    const failCount = validScores.filter((score) => score < passingScore).length;

    const avgScore =
      validScores.length > 0
        ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
        : 0;

    return {
      name: course.title,
      score: avgScore,
      passingScore,
      passCount,
      failCount,
    };
  });

  // --- Training Coverage ---
  // Classify each unique staff member by their aggregate status across ALL their enrollments.
  // Classification priority (highest wins): in_progress > not_started (enrolled) > completed.
  // A user who has finished some courses but has others still "enrolled" is shown as in_progress
  // because they have outstanding training — this gives the most actionable signal for admins.
  const enrollmentsByUser = new Map<
    string,
    { hasCompleted: boolean; hasInProgress: boolean; hasNotStarted: boolean }
  >();
  for (const row of userStatusCounts) {
    const entry = enrollmentsByUser.get(row.organizationUserId) ?? {
      hasCompleted: false,
      hasInProgress: false,
      hasNotStarted: false,
    };
    if (row.status === 'completed' || row.status === 'attested') {
      entry.hasCompleted = true;
    } else if (row.status === 'in_progress') {
      entry.hasInProgress = true;
    } else {
      // 'enrolled' / 'assigned' — course has been assigned but not yet started
      entry.hasNotStarted = true;
    }
    enrollmentsByUser.set(row.organizationUserId, entry);
  }

  // Distinct staff with at least one enrollment across this admin's courses.
  const totalStaffAssigned = enrollmentsByUser.size;

  let staffCompleted = 0;
  let staffInProgress = 0;
  let staffNotStarted = 0;
  for (const record of enrollmentsByUser.values()) {
    if (record.hasInProgress || record.hasNotStarted) {
      // Any outstanding (in_progress or unstarted) enrollment means the user is not fully done.
      // Distinguish the two for more granular UI display.
      if (record.hasInProgress) {
        staffInProgress++;
      } else {
        staffNotStarted++;
      }
    } else {
      // All enrollments are completed/attested.
      staffCompleted++;
    }
  }

  // Users who were never enrolled at all are added to the 'not started' figure.
  // This ensures the total base reflects the entire organization staff.
  const staffWithNoEnrollments = Math.max(0, totalOrgStaff - enrollmentsByUser.size);
  staffNotStarted += staffWithNoEnrollments;

  const coverageBase = totalOrgStaff > 0 ? totalOrgStaff : enrollmentsByUser.size;

  // Use largest-remainder (Hamilton) rounding so the three percentages always sum to exactly 100.
  let pctCompleted = 0;
  let pctInProgress = 0;
  let pctNotStarted = 0;
  if (coverageBase > 0) {
    const rawCompleted = (staffCompleted / coverageBase) * 100;
    const rawInProgress = (staffInProgress / coverageBase) * 100;
    const rawNotStarted = (staffNotStarted / coverageBase) * 100;

    pctCompleted = Math.floor(rawCompleted);
    pctInProgress = Math.floor(rawInProgress);
    pctNotStarted = Math.floor(rawNotStarted);

    // Distribute remaining integer points to whichever values have the largest fractional parts.
    const remainder = 100 - pctCompleted - pctInProgress - pctNotStarted;
    const fractions = [
      { key: 'completed' as const, frac: rawCompleted - pctCompleted },
      { key: 'inProgress' as const, frac: rawInProgress - pctInProgress },
      { key: 'notStarted' as const, frac: rawNotStarted - pctNotStarted },
    ].sort((a, b) => b.frac - a.frac);

    for (let i = 0; i < remainder; i++) {
      if (fractions[i].key === 'completed') pctCompleted++;
      else if (fractions[i].key === 'inProgress') pctInProgress++;
      else pctNotStarted++;
    }
  }

  return {
    courses,
    stats: {
      totalCourses,
      totalStaffAssigned,
      averageGrade: averageScore,
      monthlyPerformance,
      coursePerformance,
      trainingCoverage: {
        completed: pctCompleted,
        inProgress: pctInProgress,
        notStarted: pctNotStarted,
        totalStaff: totalStaffAssigned,
      },
    },
  };
}

export async function assignCourseToUsers(courseId: string, emails: string[]) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // 1. Verify Course Ownership
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { createdByOrgUserId: true, title: true },
  });

  if (!course || course.createdByOrgUserId !== session.user.organizationUserId) {
    logger.warn({
      msg: '[course] assignCourseToUsers: not found or unauthorized',
      courseId,
      userId: session.user.id,
    });
    throw new Error('Course not found or unauthorized');
  }

  // 2. Get Current Org's billing status to ensure we only assign to own staff
  const organizationId = session.user.organizationId;
  if (!organizationId) {
    throw new Error('You must belong to an organization to assign courses');
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      subscription: { select: { status: true, pausedAt: true } },
    },
  });

  // Billing gate (defense in depth): assigning courses requires active billing.
  if (!hasActiveBilling(organization?.subscription)) {
    logger.warn({
      msg: '[course] Course assignment blocked — organization lacks active billing',
      organizationId,
      userId: session.user.id,
    });
    throw new Error('Your organization needs an active subscription to assign courses.');
  }

  // 3. Find Staff Memberships by Email (filtered by Org)
  const membersToAssign = await prisma.organizationUser.findMany({
    where: {
      organizationId,
      active: true,
      user: { email: { in: emails } },
    },
    select: { id: true, user: { select: { email: true } } },
  });

  if (membersToAssign.length === 0) {
    logger.warn({
      msg: '[course] assignCourseToUsers: no valid users found',
      courseId,
      emailCount: emails.length,
    });
    return { success: false, message: 'No valid users found to assign.' };
  }

  // 4. Create Enrollments (skip duplicates)
  const facilityByMember = await resolveMemberFacilityIds(
    prisma,
    membersToAssign.map((m) => m.id),
  );

  const enrollmentData = membersToAssign.map((m) => ({
    organizationUserId: m.id,
    courseId: courseId,
    facilityId: facilityByMember.get(m.id) ?? null,
    status: 'enrolled' as const,
    progress: 0,
    startedAt: new Date(),
  }));

  const results = await prisma.enrollment.createMany({
    data: enrollmentData,
    skipDuplicates: true,
  });

  logger.info({
    msg: '[course] Users assigned to course',
    courseId,
    userId: session.user.id,
    enrolled: results.count,
  });
  revalidatePath('/dashboard/training');
  return { success: true, count: results.count };
}

// Outcome of the server-side course quality assessment used by the publish-review
// gate (F-051). `reviewRequired` gates publishing; `qualityWarnings` are the
// human-readable reasons surfaced in the wizard.
interface CourseQualityAssessment {
  reviewRequired: boolean;
  qualityWarnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Derive the publish-review gate from the raw AI artifacts persisted with a
 * course. This runs SERVER-SIDE and never trusts a client-supplied flag: the
 * assessment is computed purely from the generated artifacts so a degraded
 * generation cannot be silently published.
 *
 * The slides / judge / article-meta checks are specific to the v4.6 pipeline
 * (identified by the presence of `rawArticleMeta`); v3.1 and manually authored
 * courses that never produce those artifacts are left untouched.
 *
 * Kept as an internal (non-exported) helper: `course.ts` is a `'use server'`
 * module, so only async server actions may be exported. Its behaviour is
 * covered through `createFullCourse` in the unit tests.
 */
function assessCourseQuality(input: {
  quizQuestionCount: number;
  rawQuizJson?: unknown;
  rawSlidesJson?: unknown;
  rawJudgeJson?: unknown;
  rawArticleMeta?: unknown;
}): CourseQualityAssessment {
  const qualityWarnings: string[] = [];

  // 1. Quiz — missing entirely, or fewer questions than requested. Only applies
  //    when a quiz artifact exists (an AI generation attempted a quiz).
  if (isRecord(input.rawQuizJson)) {
    const quizMeta = isRecord(input.rawQuizJson.meta) ? input.rawQuizJson.meta : undefined;
    const requestedQuestionCount =
      typeof quizMeta?.requestedQuestionCount === 'number' ? quizMeta.requestedQuestionCount : 0;

    if (input.quizQuestionCount === 0) {
      qualityWarnings.push('No quiz questions were generated for this course.');
    } else if (requestedQuestionCount > 0 && input.quizQuestionCount < requestedQuestionCount) {
      qualityWarnings.push(
        `The quiz has only ${input.quizQuestionCount} of the ${requestedQuestionCount} requested questions.`,
      );
    }
  }

  const isV46 = isRecord(input.rawArticleMeta);

  // 2. Slides — a v4.6 course is expected to have generated slides.
  if (isV46) {
    const slides =
      isRecord(input.rawSlidesJson) && Array.isArray(input.rawSlidesJson.slides)
        ? input.rawSlidesJson.slides
        : [];
    if (slides.length === 0) {
      qualityWarnings.push('No slides were generated for this course.');
    }
  }

  // 3. Judge — the quiz reviewer flagged unresolved (ambiguous or invalid) questions.
  if (isRecord(input.rawJudgeJson)) {
    const ambiguousCount = Array.isArray(input.rawJudgeJson.ambiguous)
      ? input.rawJudgeJson.ambiguous.length
      : 0;
    const invalidCount = Array.isArray(input.rawJudgeJson.invalid)
      ? input.rawJudgeJson.invalid.length
      : 0;
    const flaggedCount = ambiguousCount + invalidCount;
    if (flaggedCount > 0) {
      qualityWarnings.push(
        `The automated quiz review flagged ${flaggedCount} question${
          flaggedCount === 1 ? '' : 's'
        } as ambiguous or invalid.`,
      );
    }
  }

  // 4. Article meta — the source document lacked enough content for reliable training.
  if (isV46) {
    const articleMeta = input.rawArticleMeta as Record<string, unknown>;
    const meta = isRecord(articleMeta.meta) ? articleMeta.meta : undefined;
    if (meta?.status === 'needs_sources') {
      qualityWarnings.push(
        'The source document did not provide enough content to generate reliable training.',
      );
    }
  }

  return { reviewRequired: qualityWarnings.length > 0, qualityWarnings };
}

export async function createFullCourse(data: {
  title: string;
  description: string;
  difficulty: string;
  duration: string;
  categoryId?: string;
  objectives?: string[];
  modules: { title: string; content: string; slideContent?: string; duration: string }[];
  quiz: QuizQuestion[];
  assignments: string[];
  dueDate?: Date;
  dueTime?: string;
  // Quiz settings from Step 4
  quizTitle?: string;
  quizPassMark?: string;
  quizQuestionType?: string;
  quizAttempts?: string;
  quizDuration?: string;
  quizDifficulty?: string;
  documentId?: string;
  // v3.1 raw JSON for persistence
  rawCourseJson?: unknown;
  rawQuizJson?: unknown;
  // v4.6 raw artifacts for persistence
  rawArticleMeta?: unknown;
  rawArticleMarkdown?: string;
  rawSlidesJson?: unknown;
  rawJudgeJson?: unknown;
}) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  if (!session.user.organizationUserId) {
    throw new Error('Organization not found');
  }

  // Detect prompt version
  const promptVersion = data.rawArticleMeta ? 'v4.6' : data.rawCourseJson ? 'v3.1' : undefined;

  // Compute the publish-review gate SERVER-SIDE from the persisted artifacts.
  // A degraded generation is saved as a draft with warnings rather than published.
  const { reviewRequired, qualityWarnings } = assessCourseQuality({
    quizQuestionCount: data.quiz.length,
    rawQuizJson: data.rawQuizJson,
    rawSlidesJson: data.rawSlidesJson,
    rawJudgeJson: data.rawJudgeJson,
    rawArticleMeta: data.rawArticleMeta,
  });

  // 1. Create Course, Lessons, Quiz in one transaction (nested write)
  const course = await prisma.course.create({
    data: {
      title: data.title,
      description: data.description,
      categoryId: data.categoryId || null,
      duration: parseInt(data.duration) || 0,
      objectives: data.objectives || [],
      status: reviewRequired ? 'draft' : 'published',
      reviewRequired,
      qualityWarnings,
      createdByOrgUserId: session.user.organizationUserId,
      // Pipeline version tracking
      promptVersion,
      // v3.1 fields
      rawCourseJson: data.rawCourseJson || undefined,
      rawQuizJson: data.rawQuizJson || undefined,
      // v4.6 fields
      rawArticleMeta: data.rawArticleMeta || undefined,
      rawArticleMarkdown: data.rawArticleMarkdown || undefined,
      rawSlidesJson: data.rawSlidesJson || undefined,
      rawJudgeJson: data.rawJudgeJson || undefined,
      lessons: {
        create: data.modules.map((mod, index) => ({
          title: mod.title,
          content: mod.content,
          slideContent: mod.slideContent || null,
          order: index,
          duration: parseInt(mod.duration.replace(' min', '')) || 10,
          quiz:
            index === data.modules.length - 1 && data.quiz.length > 0
              ? {
                  create: {
                    title: data.quizTitle || 'Course Quiz',
                    passingScore: parseInt(data.quizPassMark?.replace('%', '') || '70'),
                    allowedAttempts:
                      data.quizAttempts === 'unlimited' || !data.quizAttempts
                        ? null
                        : parseInt(data.quizAttempts),
                    timeLimit: parseInt(data.quizDuration?.replace(/\D/g, '') || '15'),
                    difficulty: data.quizDifficulty || 'medium',
                    questions: {
                      create: data.quiz.map((q, qIndex) => ({
                        text: q.question,
                        type: q.type || data.quizQuestionType || 'multiple_choice',
                        options: q.options,
                        correctAnswer: q.options[q.answer],
                        order: qIndex,
                        // v3.1 embedded fields
                        explanation: q.explanation?.correctExplanation || undefined,
                        archetype: q.archetype || undefined,
                        evidence: q.evidence || undefined,
                      })),
                    },
                  },
                }
              : undefined,
        })),
      },
    },
  });

  // 1.5 Link Document if provided
  if (data.documentId) {
    // Find latest version of the document
    const latestDocVersion = await prisma.documentVersion.findFirst({
      where: { documentId: data.documentId },
      orderBy: { version: 'desc' },
    });

    if (latestDocVersion) {
      await prisma.courseVersion.create({
        data: {
          courseId: course.id,
          documentVersionId: latestDocVersion.id,
          version: 1,
        },
      });
    }
  }

  // 2. Handle Assignments — delegate to enrollUsers so wizard-assigned workers
  // get the same CourseAssignment, per-user deadline, seeded reminder ladder,
  // INITIAL_LAUNCH log, and launch email as the standalone assign flow. The old
  // bespoke path wrote bare enrollments with no dueAt and no reminders, silently
  // disabling escalation for wizard-assigned workers (Issue #2).
  const inviteResults = {
    existingEnrolled: 0,
    newInvited: 0,
    failed: [] as string[],
    skipped: [] as string[],
  };

  if (data.assignments && data.assignments.length > 0) {
    const dueAt = combineDateAndTime(data.dueDate, data.dueTime);
    const staffEntries: StaffEntry[] = data.assignments.map((email) => ({ email }));

    // Enrollment problems must never fail course creation — the course already
    // exists. enrollUsers throws on org-level gates (billing/authorization); a
    // per-user failure is reported in its result and never thrown.
    try {
      const enrollResults = await enrollUsers(course.id, staffEntries, { dueAt });
      inviteResults.existingEnrolled = enrollResults.success.length;
      inviteResults.newInvited = enrollResults.newInvited.length;
      inviteResults.failed = enrollResults.failed;
      inviteResults.skipped = enrollResults.alreadyEnrolled;
    } catch (enrollError) {
      logger.error({
        msg: '[course] Failed to assign workers during course creation',
        courseId: course.id,
        err: enrollError,
      });
    }
  }

  logger.info({
    msg: '[course] Full course created',
    courseId: course.id,
    userId: session.user.id,
    promptVersion,
    reviewRequired,
    warnings: qualityWarnings.length,
    enrolled: inviteResults.existingEnrolled,
    invited: inviteResults.newInvited,
    failed: inviteResults.failed.length,
    skipped: inviteResults.skipped.length,
  });
  revalidatePath('/dashboard/training');
  return {
    success: true,
    courseId: course.id,
    reviewRequired,
    qualityWarnings,
    inviteResults,
  };
}

export async function attestCourse(enrollmentId: string, signature: string, role: string) {
  // Resolve BOTH sessions to handle cookie collision (admin + worker in same browser)
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      organizationUser: { include: { user: true } },
      course: true,
    },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  // Check if EITHER session owns this enrollment (handles cookie collision)
  if (
    enrollment.organizationUser.userId !== adminId &&
    enrollment.organizationUser.userId !== workerId
  ) {
    throw new Error('Unauthorized');
  }

  if (!signature.trim()) {
    throw new Error(`Signature is required.`);
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'attested',
      attestedAt: new Date(),
      attestationSignature: signature,
      attestationRole: role, // Now acts as job description
    },
  });

  logger.info({
    msg: '[course] Course attested',
    enrollmentId,
    courseId: enrollment.courseId,
    userId: enrollment.organizationUser.userId,
  });

  // Clear any open overdue/escalation/retake reminders for this enrollment now
  // that it has reached a terminal status, so the compliance banner/page
  // self-clear. Never throws (errors are logged internally).
  await resolveOnCompletion(enrollmentId);

  // Notify Admins of course completion
  await notifyOrganizationAdmins(enrollment.organizationUser.organizationId, {
    type: 'COURSE_PASSED',
    title: 'Course Completed',
    message: `${enrollment.organizationUser.user.fullName || enrollment.organizationUser.user.email} has completed and attested to the course: ${enrollment.course?.title || 'Unknown Course'}.`,
    linkUrl: `/dashboard/staff/${enrollment.organizationUserId}`,
    metadata: { organizationUserId: enrollment.organizationUserId, courseId: enrollment.courseId },
  });

  revalidatePath('/worker');
  revalidatePath(`/learn/${enrollment.courseId}`);
  return { success: true };
}

export async function startCourse(courseId: string) {
  // Resolve BOTH sessions to handle cookie collision
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  // Try to find enrollment for either session user
  let enrollment = null;
  if (workerId) {
    enrollment = await prisma.enrollment.findFirst({
      where: { courseId, organizationUser: { userId: workerId } },
    });
  }
  if (!enrollment && adminId) {
    enrollment = await prisma.enrollment.findFirst({
      where: { courseId, organizationUser: { userId: adminId } },
    });
  }

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  if (enrollment.status === 'enrolled' || enrollment.status === 'assigned') {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'in_progress',
        progress: enrollment.progress === 0 ? 1 : enrollment.progress, // Ensure at least 1%
        startedAt: enrollment.startedAt || new Date(),
      },
    });

    logger.info({
      msg: '[course] Course started (status → in_progress)',
      courseId,
      enrollmentId: enrollment.id,
    });
    revalidatePath('/dashboard/worker');
    revalidatePath(`/worker/courses/${courseId}`);
  }

  return { success: true };
}

export async function updateQuizQuestions(
  courseId: string,
  questions: {
    question: string;
    options: string[];
    answer: number;
    type?: string;
    explanation?: string;
  }[],
) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { lessons: { include: { quiz: true } } },
  });

  if (!course || course.createdByOrgUserId !== session.user.organizationUserId) {
    throw new Error('Unauthorized or Course not found');
  }

  const lessonWithQuiz = course.lessons.find((l) => l.quiz);
  if (!lessonWithQuiz || !lessonWithQuiz.quiz) {
    throw new Error('Quiz not found in this course');
  }
  const quizId = lessonWithQuiz.quiz.id;

  // Shuffle options for each question so correct answers are scattered across A-D
  const shuffleOptions = (
    options: string[],
    correctIdx: number,
  ): { options: string[]; correctIdx: number } => {
    const tagged = options.map((text, i) => ({ text, isCorrect: i === correctIdx }));
    for (let i = tagged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
    }
    return {
      options: tagged.map((o) => o.text),
      correctIdx: tagged.findIndex((o) => o.isCorrect),
    };
  };

  await prisma.$transaction(async (tx) => {
    await tx.question.deleteMany({ where: { quizId: quizId } });
    if (questions.length > 0) {
      await tx.question.createMany({
        data: questions.map((q, index) => {
          const shuffled = shuffleOptions(q.options, q.answer);
          return {
            quizId: quizId,
            text: q.question,
            type: q.type || 'multiple_choice',
            options: shuffled.options,
            correctAnswer: shuffled.options[shuffled.correctIdx],
            explanation: q.explanation,
            order: index,
          };
        }),
      });
    }
  });

  logger.info({
    msg: '[course] Quiz questions updated',
    courseId,
    userId: session.user.id,
    questionCount: questions.length,
  });
  revalidatePath(`/learn/${courseId}`);
  return { success: true };
}

export async function updateLessonContent(lessonId: string, content: string, title?: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { course: true },
  });

  if (!lesson || lesson.course.createdByOrgUserId !== session.user.organizationUserId) {
    throw new Error('Unauthorized or Lesson not found');
  }

  await prisma.lesson.update({
    where: { id: lessonId },
    data: {
      content,
      title: title || lesson.title,
    },
  });

  logger.info({
    msg: '[course] Lesson content updated',
    lessonId,
    courseId: lesson.courseId,
    userId: session.user.id,
  });
  revalidatePath(`/learn/${lesson.courseId}`);
  return { success: true };
}

export async function retakeQuiz(enrollmentId: string) {
  // Resolve BOTH sessions to handle cookie collision
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  const adminId = admin?.user?.id;
  const workerId = worker?.user?.id;

  if (!adminId && !workerId) {
    throw new Error('Unauthorized');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      organizationUser: { select: { userId: true } },
      course: {
        include: {
          lessons: {
            include: { quiz: true },
          },
          quiz: true,
        },
      },
    },
  });

  // Check if EITHER session owns this enrollment
  if (
    !enrollment ||
    (enrollment.organizationUser.userId !== adminId &&
      enrollment.organizationUser.userId !== workerId)
  ) {
    throw new Error('Enrollment not found or unauthorized');
  }

  // Quiz lives on the last lesson (text courses) or on the course itself
  // (video courses). Prefer the lesson quiz, fall back to the course quiz.
  const lastLesson = enrollment.course.lessons[enrollment.course.lessons.length - 1];
  const quiz = lastLesson?.quiz ?? enrollment.course.quiz;

  // Enforce the attempt limit against COMPLETED attempts (timeTaken !== null),
  // consistent with the append-history model in the quiz start/submit routes.
  // A null/0 allowedAttempts means unlimited. The fresh draft is appended by
  // /api/quiz/[id]/start; retake must not mutate historical attempts.
  if (quiz && quiz.allowedAttempts) {
    const completedCount = await prisma.quizAttempt.count({
      where: { enrollmentId, quizId: quiz.id, timeTaken: { not: null } },
    });
    if (completedCount >= quiz.allowedAttempts) {
      throw new Error('No attempts remaining');
    }
  }

  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: 'in_progress',
      score: null,
      completedAt: null,
      attestedAt: null,
      attestationSignature: null,
    },
  });

  logger.info({
    msg: '[course] Quiz retake initiated',
    enrollmentId,
    courseId: enrollment.courseId,
  });
  revalidatePath(`/learn/${enrollment.courseId}`);
  return { success: true };
}

export async function assignRetake(enrollmentId: string, retakeReason?: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Assigning someone else a retake is the same administrative verb as
  // assigning them training, so it gates on `enrollment.create` — NOT
  // `enrollment.edit`, which every role holds as a self-service permission for
  // progressing its OWN enrollment and would therefore let a read-only
  // Supervisor force a retake on another learner.
  if (!can(dbRoleToRoleKey(session.user.role), 'enrollment.create')) {
    logger.warn({
      msg: '[enrollment] assignRetake denied — missing enrollment.create',
      userId: session.user.id,
      role: session.user.role,
      enrollmentId,
    });
    throw new Error('Insufficient permissions');
  }

  const lockedEnrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      organizationUser: { include: { user: true } },
      course: true,
    },
  });

  if (!lockedEnrollment) {
    throw new Error('Enrollment not found');
  }

  if (lockedEnrollment.status !== 'locked') {
    throw new Error('Enrollment is not locked');
  }

  const existingRetake = await prisma.enrollment.findFirst({
    where: { retakeOf: enrollmentId, status: 'enrolled' },
  });
  if (existingRetake) {
    throw new Error('An active retake already exists for this enrollment');
  }

  const retakeEnrollment = await prisma.enrollment.create({
    data: {
      organizationUserId: lockedEnrollment.organizationUserId,
      courseId: lockedEnrollment.courseId,
      // Resolved fresh rather than inherited from the locked enrollment: a retake
      // is new training, so it belongs to wherever the learner is posted now.
      facilityId: await resolveMemberFacilityId(prisma, lockedEnrollment.organizationUserId),
      status: 'enrolled',
      progress: 100,
      retakeOf: lockedEnrollment.id,
      retakeReason: retakeReason || null,
      assignedByAdminId: session.user.id,
    },
  });

  await prisma.notification.updateMany({
    where: {
      type: { in: ['QUIZ_RETRY_LIMIT_REACHED', 'COURSE_RETRY_REQUESTED'] },
      resolvedAt: null,
      metadata: { path: ['enrollmentId'], equals: enrollmentId },
    },
    data: {
      resolvedAt: new Date(),
      isRead: true,
    },
  });

  const { createNotification } = await import('./notifications');
  await createNotification({
    organizationUserId: lockedEnrollment.organizationUserId,
    type: 'RETAKE_ASSIGNED',
    title: 'Retake Assigned',
    message: `An admin has assigned you a retake for "${lockedEnrollment.course.title}". You can now take the quiz again.`,
    linkUrl: `/learn/${lockedEnrollment.courseId}`,
    metadata: {
      enrollmentId: retakeEnrollment.id,
      courseId: lockedEnrollment.courseId,
      parentEnrollmentId: lockedEnrollment.id,
    },
  });

  logger.info({
    msg: '[course] Retake assigned by admin',
    retakeEnrollmentId: retakeEnrollment.id,
    parentEnrollmentId: enrollmentId,
    courseId: lockedEnrollment.courseId,
    assignedBy: session.user.id,
    targetOrganizationUserId: lockedEnrollment.organizationUserId,
  });
  revalidatePath('/dashboard/staff');
  revalidatePath('/worker/trainings');
  revalidatePath(`/learn/${lockedEnrollment.courseId}`);

  return { success: true, retakeEnrollmentId: retakeEnrollment.id };
}
