'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

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
  coursesAssigned: number;
  coursesCompleted: number;
  lastActivity: Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });
  if (!user || user.role !== 'admin' || !user.organizationId) {
    throw new Error('Unauthorized');
  }
  return { userId: session.user.id, organizationId: user.organizationId };
}

// ---------------------------------------------------------------------------
// Check Auditor Access (billing gate)
// ---------------------------------------------------------------------------

export async function checkAuditorAccess(): Promise<boolean> {
  try {
    const { organizationId } = await requireAdminSession();
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

export async function getAuditorOverviewStats(): Promise<AuditorOverviewStats> {
  const { organizationId } = await requireAdminSession();

  // Courses created within this org (by any admin/user in the org)
  const orgUserIds = await prisma.user
    .findMany({
      where: { organizationId },
      select: { id: true },
    })
    .then((users) => users.map((u) => u.id));

  const [totalCourses, enrollmentStats, staffCount] = await Promise.all([
    // Count published courses created by org users
    prisma.course.count({
      where: { createdBy: { in: orgUserIds }, status: 'published' },
    }),
    // Enrollment stats for all org workers
    prisma.enrollment.findMany({
      where: { userId: { in: orgUserIds } },
      select: { status: true },
    }),
    // Staff count (workers only)
    prisma.user.count({
      where: { organizationId, role: 'worker' },
    }),
  ]);

  const totalEnrollments = enrollmentStats.length;
  const completedEnrollments = enrollmentStats.filter((e) =>
    ['completed', 'attested'].includes(e.status),
  ).length;

  const completionRate =
    totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0;

  console.info('[auditor] overview stats fetched', {
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

export async function getAuditorCourses(search?: string): Promise<AuditorCourseRow[]> {
  const { organizationId } = await requireAdminSession();

  const orgUserIds = await prisma.user
    .findMany({
      where: { organizationId },
      select: { id: true },
    })
    .then((users) => users.map((u) => u.id));

  const courses = await prisma.course.findMany({
    where: {
      createdBy: { in: orgUserIds },
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
        select: { userId: true, status: true },
      },
    },
  });

  return courses.map((course) => {
    const orgEnrollments = course.enrollments.filter((e) => orgUserIds.includes(e.userId));
    const total = orgEnrollments.length;
    const completed = orgEnrollments.filter((e) =>
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

export async function getAuditorStaff(search?: string): Promise<AuditorStaffRow[]> {
  const { organizationId } = await requireAdminSession();

  const workers = await prisma.user.findMany({
    where: {
      organizationId,
      role: 'worker',
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              {
                profile: {
                  fullName: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      profile: { select: { fullName: true } },
      enrollments: {
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
    const lastActivity = worker.enrollments.find((e) => e.completedAt)?.completedAt ?? null;

    return {
      id: worker.id,
      name: worker.profile?.fullName ?? worker.email.split('@')[0],
      email: worker.email,
      coursesAssigned: total,
      coursesCompleted: completed,
      lastActivity,
    };
  });
}

// ---------------------------------------------------------------------------
// Export — returns CSV string for streaming download
// ---------------------------------------------------------------------------

export async function generateAuditorPackCsv(): Promise<string> {
  const { organizationId } = await requireAdminSession();

  const orgUserIds = await prisma.user
    .findMany({ where: { organizationId }, select: { id: true } })
    .then((u) => u.map((x) => x.id));

  const enrollments = await prisma.enrollment.findMany({
    where: { userId: { in: orgUserIds } },
    include: {
      user: { include: { profile: { select: { fullName: true } } } },
      course: { select: { title: true } },
    },
    orderBy: { startedAt: 'desc' },
  });

  const rows = [
    ['Staff Name', 'Email', 'Course', 'Status', 'Progress (%)', 'Started At', 'Completed At'],
    ...enrollments.map((e) => [
      e.user.profile?.fullName ?? e.user.email,
      e.user.email,
      e.course.title,
      e.status,
      String(e.progress),
      e.startedAt.toISOString(),
      e.completedAt?.toISOString() ?? '',
    ]),
  ];

  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}
