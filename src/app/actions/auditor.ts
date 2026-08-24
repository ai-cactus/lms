'use server';

import { auth } from '@/auth';
import { dbRoleToRoleKey, getRoleDisplayName, WORKER_ROLES } from '@/lib/rbac/role-utils';
import { can, type Permission } from '@/lib/rbac/permissions';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { startedAtWhere, type AuditDateRangeInput } from '@/lib/audit-reports/date-range';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditorOverviewStats {
  totalCourses: number;
  totalStaffAssigned: number;
  completionRate: number;
}

export interface AuditorCourseRow {
  id: string;
  title: string;
  thumbnail: string | null;
  assignedStaff: number;
  completionRate: number;
  assignedDate: Date;
}

export interface AuditorStaffRow {
  id: string;
  name: string;
  email: string;
  /**
   * Rendered under the "Department/Role" column. The data model has no
   * department entity, so this pairs the membership's free-text job title with
   * the RBAC role display name, falling back to the role alone when no job
   * title is recorded.
   */
  roleLabel: string;
  coursesAssigned: number;
  coursesCompleted: number;
  /** Most recent enrollment completion, or null when nothing has completed. */
  lastCompletion: Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * D-01: these are `'use server'` exports, so they are POST-invocable directly
 * and bypass every page-level gate. They were guarded by `isAdminRole`, which
 * admits Finance and Clinical Director — neither of whom holds any auditPack
 * permission. Fixing only the audit-reports page would have left this open.
 *
 * `auditPack.read` for the read surfaces; `auditPack.create` for the pack
 * generator, which produces bulk PHI/PII egress.
 */
async function requireAuditorSession(permission: Permission) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const { role, organizationId } = session.user;
  const roleKey = dbRoleToRoleKey(role);
  if (!roleKey || !can(roleKey, permission) || !organizationId) {
    logger.warn({
      msg: '[auditor] Permission denied',
      userId: session.user.id,
      role,
      permission,
    });
    throw new Error('Unauthorized');
  }
  return { userId: session.user.id, organizationId };
}

// ---------------------------------------------------------------------------
// Check Auditor Access (billing gate)
// ---------------------------------------------------------------------------

export async function checkAuditorAccess(): Promise<boolean> {
  try {
    const { organizationId } = await requireAuditorSession('auditPack.read');
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { hasAuditorAccess: true },
    });
    return org?.hasAuditorAccess ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Overview Stats
// ---------------------------------------------------------------------------

export async function getAuditorOverviewStats(
  range?: AuditDateRangeInput,
): Promise<AuditorOverviewStats> {
  const { organizationId } = await requireAuditorSession('auditPack.read');
  const dateWhere = startedAtWhere(range);

  const [totalCourses, enrollmentStats, staffCount] = await Promise.all([
    // Count published courses created by org users
    prisma.course.count({
      where: { creator: { organizationId }, status: 'published' },
    }),
    // Enrollment stats for all org workers (completion rate respects the range)
    prisma.enrollment.findMany({
      where: { organizationUser: { organizationId }, ...dateWhere },
      select: { status: true },
    }),
    // Staff count (workers only)
    prisma.organizationUser.count({
      where: { organizationId, role: { in: [...WORKER_ROLES] } },
    }),
  ]);

  const totalEnrollments = enrollmentStats.length;
  const completedEnrollments = enrollmentStats.filter((e) =>
    ['completed', 'attested'].includes(e.status),
  ).length;

  const completionRate =
    totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0;

  logger.info({
    msg: '[auditor] overview stats fetched',
    organizationId,
    totalCourses,
    staffCount,
    completionRate,
  });

  return {
    totalCourses,
    totalStaffAssigned: staffCount,
    completionRate,
  };
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export async function getAuditorCourses(
  search?: string,
  range?: AuditDateRangeInput,
): Promise<AuditorCourseRow[]> {
  const { organizationId } = await requireAuditorSession('auditPack.read');
  const dateWhere = startedAtWhere(range);

  const courses = await prisma.course.findMany({
    where: {
      creator: { organizationId },
      status: 'published',
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      thumbnail: true,
      createdAt: true,
      enrollments: {
        // Per-course stats reflect only enrollments started within the range,
        // scoped to this org (a global course may be enrolled by other orgs too).
        where: { organizationUser: { organizationId }, ...dateWhere },
        select: { status: true },
      },
    },
  });

  return courses.map((course) => {
    const total = course.enrollments.length;
    const completed = course.enrollments.filter((e) =>
      ['completed', 'attested'].includes(e.status),
    ).length;

    return {
      id: course.id,
      title: course.title,
      thumbnail: course.thumbnail,
      assignedStaff: total,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      assignedDate: course.createdAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function getAuditorStaff(
  search?: string,
  range?: AuditDateRangeInput,
): Promise<AuditorStaffRow[]> {
  const { organizationId } = await requireAuditorSession('auditPack.read');
  const dateWhere = startedAtWhere(range);

  const workers = await prisma.organizationUser.findMany({
    where: {
      organizationId,
      role: { in: [...WORKER_ROLES] },
      ...(search
        ? {
            OR: [
              { user: { email: { contains: search, mode: 'insensitive' } } },
              { user: { fullName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      role: true,
      jobTitle: true,
      user: { select: { email: true, fullName: true } },
      enrollments: {
        // Per-staff stats reflect only enrollments started within the range.
        where: dateWhere,
        select: { status: true, completedAt: true },
        orderBy: { startedAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return workers.map((worker) => {
    const total = worker.enrollments.length;
    const completed = worker.enrollments.filter((e) =>
      ['completed', 'attested'].includes(e.status),
    ).length;
    // Enrollments are ordered by start date, so the newest completion is not
    // necessarily the first one carrying a `completedAt` — take the maximum.
    const lastCompletion = worker.enrollments.reduce<Date | null>(
      (latest, e) =>
        e.completedAt && (!latest || e.completedAt > latest) ? e.completedAt : latest,
      null,
    );
    const roleDisplayName = getRoleDisplayName(worker.role);

    return {
      id: worker.id,
      name: worker.user.fullName ?? worker.user.email.split('@')[0],
      email: worker.user.email,
      roleLabel: worker.jobTitle ? `${worker.jobTitle}/ ${roleDisplayName}` : roleDisplayName,
      coursesAssigned: total,
      coursesCompleted: completed,
      lastCompletion,
    };
  });
}

// ---------------------------------------------------------------------------
// Export — returns CSV string for streaming download
// ---------------------------------------------------------------------------

export async function generateAuditorPackCsv(): Promise<string> {
  const { organizationId } = await requireAuditorSession('auditPack.create');

  const enrollments = await prisma.enrollment.findMany({
    where: { organizationUser: { organizationId } },
    include: {
      organizationUser: { include: { user: { select: { email: true, fullName: true } } } },
      course: { select: { title: true } },
    },
    orderBy: { startedAt: 'desc' },
  });

  const rows = [
    ['Staff Name', 'Email', 'Course', 'Status', 'Progress (%)', 'Started At', 'Completed At'],
    ...enrollments.map((e) => [
      e.organizationUser.user.fullName ?? e.organizationUser.user.email,
      e.organizationUser.user.email,
      e.course.title,
      e.status,
      String(e.progress),
      e.startedAt.toISOString(),
      e.completedAt?.toISOString() ?? '',
    ]),
  ];

  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}
