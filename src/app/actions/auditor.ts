'use server';

import { auth } from '@/auth';
import { dbRoleToRoleKey, getRoleDisplayName } from '@/lib/rbac/role-utils';
import { can, type Permission } from '@/lib/rbac/permissions';
import { resolveDataFacilityIds, staffFacilityWhere } from '@/lib/facility/staff-where';
import { auditorCatalogueWhere } from '@/lib/audit-reports/catalogue-scope';
import prisma from '@/lib/prisma';
import { rawPrisma } from '@/db/index';
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
  /** `CourseStatus`. Only `published` and `inactive` reach an auditor: a retired
   * course was in service and its records are evidence, a draft never was. */
  status: string;
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
  // D-01 + #17. `subjectWhere` narrows WHOSE records appear; the course
  // catalogue is org-level and is deliberately never narrowed by it.
  //
  // A supervisor is facility-scoped here like everywhere else (team test
  // 2026-09-03). This surface used to widen them to the whole org via a local
  // `resolveAuditFacilityIds`, which put the page out of step with the rest of
  // the product AND broke their export outright: `export/start` stamped the
  // widened scope onto the job while the status/download routes re-derived the
  // narrow one and refused any job whose scope theirs did not contain.
  const subjectWhere = staffFacilityWhere(await resolveDataFacilityIds(session));

  return { userId: session.user.id, organizationId, subjectWhere };
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
  const { organizationId, subjectWhere } = await requireAuditorSession('auditPack.read');
  const dateWhere = startedAtWhere(range);
  const courseWhere = await auditorCatalogueWhere(organizationId);

  const [totalCourses, enrollmentStats, staffCount] = await Promise.all([
    // Course CATALOGUE — org-level, never facility-narrowed (#17). Status is
    // narrowed in exactly one way, by `auditorCatalogueWhere`: DRAFTS ARE
    // EXCLUDED, superseding the earlier ruling that this spans every status.
    // Retired (`inactive`) courses stay — they were in service. ⛔ `rawPrisma`
    // for the same reason an ARCHIVED course is kept (Q24) — and because the
    // export worker counts them, so filtering here alone would show the auditor
    // one number on screen and a different one in the PDF they download. That
    // is why the draft exclusion lives in the shared predicate and not inline.
    //
    // This widens the CATALOGUE only. The enrollment and staff queries below
    // are SUBJECT data and stay on the filtered client with their facility
    // narrowing intact — archived courses becoming visible must never turn into
    // another facility's staff becoming visible.
    rawPrisma.course.count({ where: courseWhere }),
    // Enrollment stats — SUBJECT data, narrowed.
    prisma.enrollment.findMany({
      where: { organizationUser: { organizationId, ...subjectWhere }, ...dateWhere },
      select: { status: true },
    }),
    // Staff count — SUBJECT data, narrowed. Every member counts, not just the
    // eight worker roles: a manager who carries training is training this org
    // has to evidence.
    prisma.organizationUser.count({
      where: { organizationId, ...subjectWhere },
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
  const { organizationId, subjectWhere } = await requireAuditorSession('auditPack.read');
  const dateWhere = startedAtWhere(range);
  const courseWhere = await auditorCatalogueWhere(organizationId);

  // Course list itself is NOT facility-narrowed — org-level catalogue (#17).
  // It is status-narrowed in exactly one way: DRAFTS ARE EXCLUDED, superseding
  // the earlier ruling that this list spans every status. Retired (`inactive`)
  // courses stay listed. ⛔ `rawPrisma` still extends it to ARCHIVED courses
  // (Q24), and the exclusion comes from `auditorCatalogueWhere` so this list and
  // the export worker's cannot drift apart.
  //
  // Only the COURSE ROW is widened. The nested `enrollments` filter below keeps
  // both its organisation pin and `subjectWhere` (the caller's facility scope),
  // so a facility-bound auditor still sees an archived course with ZEROES rather
  // than another facility's learners.
  const courses = await rawPrisma.course.findMany({
    where: {
      ...courseWhere,
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      thumbnail: true,
      status: true,
      createdAt: true,
      enrollments: {
        // Per-course stats reflect only enrollments started within the range,
        // scoped to this org (a global course may be enrolled by other orgs too)
        // and, for a facility-bound caller, to their facilities. The course row
        // itself still appears — with zeroes — which is what #17 asks for.
        where: { organizationUser: { organizationId, ...subjectWhere }, ...dateWhere },
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
      status: course.status,
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
  const { organizationId, subjectWhere } = await requireAuditorSession('auditPack.read');
  const dateWhere = startedAtWhere(range);

  const members = await prisma.organizationUser.findMany({
    // Every member of the org, not just the eight worker roles — an owner,
    // supervisor or HR manager who holds training has a record an auditor asks
    // for by name.
    where: {
      organizationId,
      ...subjectWhere,
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

  return members.map((member) => {
    const total = member.enrollments.length;
    const completed = member.enrollments.filter((e) =>
      ['completed', 'attested'].includes(e.status),
    ).length;
    // Enrollments are ordered by start date, so the newest completion is not
    // necessarily the first one carrying a `completedAt` — take the maximum.
    const lastCompletion = member.enrollments.reduce<Date | null>(
      (latest, e) =>
        e.completedAt && (!latest || e.completedAt > latest) ? e.completedAt : latest,
      null,
    );
    const roleDisplayName = getRoleDisplayName(member.role);

    return {
      id: member.id,
      name: member.user.fullName ?? member.user.email.split('@')[0],
      email: member.user.email,
      roleLabel: member.jobTitle ? `${member.jobTitle}/ ${roleDisplayName}` : roleDisplayName,
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
  const { organizationId, subjectWhere } = await requireAuditorSession('auditPack.create');

  // Pure SUBJECT data — every row is a named person's training record with their
  // email. This is what GET /api/auditor/export returns, and it was the single
  // highest-yield path in D-01. Narrowed unconditionally.
  const enrollments = await prisma.enrollment.findMany({
    where: { organizationUser: { organizationId, ...subjectWhere } },
    include: {
      organizationUser: { include: { user: { select: { email: true, fullName: true } } } },
      course: { select: { title: true, status: true } },
    },
    orderBy: { startedAt: 'desc' },
  });

  const rows = [
    [
      'Staff Name',
      'Email',
      'Course',
      // Two different states sit side by side here: the course's own lifecycle
      // (a retired course keeps its enrollment records) and this person's
      // progress through it. Naming both avoids a bare, ambiguous "Status".
      'Course Status',
      'Enrollment Status',
      'Progress (%)',
      'Started At',
      'Completed At',
    ],
    ...enrollments.map((e) => [
      e.organizationUser.user.fullName ?? e.organizationUser.user.email,
      e.organizationUser.user.email,
      e.course.title,
      e.course.status,
      e.status,
      String(e.progress),
      e.startedAt.toISOString(),
      e.completedAt?.toISOString() ?? '',
    ]),
  ];

  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}
