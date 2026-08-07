'use server';

import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { verifySystemAdminCookie, SYSTEM_ADMIN_COOKIE } from '@/lib/system-auth';
import type { Prisma } from '@/generated/prisma/client';
import type { UserRole } from '@/generated/prisma/enums';

// ── Constants ────────────────────────────────────────────────────────────────
// Cookie name is imported from the shared utility to stay in sync.
const COOKIE_MAX_AGE = 4 * 60 * 60; // 4 hours

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSystemPassword(): string | undefined {
  return process.env.SYSTEM_ADMIN_PASSWORD;
}

function getAuthSecret(): string {
  const secret =
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    (process.env.NODE_ENV === 'development' ? 'dev-fallback-secret' : undefined);
  if (!secret) {
    throw new Error('[SystemAdmin] No NEXTAUTH_SECRET or AUTH_SECRET configured');
  }
  return secret;
}

function signToken(payload: string): string {
  const secret = getAuthSecret();
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

// ── Auth Action ──────────────────────────────────────────────────────────────

export async function verifySystemPassword(
  password: string,
): Promise<{ success: boolean; error?: string }> {
  const systemPassword = getSystemPassword();
  if (!systemPassword) {
    return { success: false, error: 'System admin is not enabled' };
  }

  if (password !== systemPassword) {
    logger.warn({ msg: 'System admin login failed: wrong password' });
    return { success: false, error: 'Invalid password' };
  }

  // Issue HMAC-signed cookie
  const expiresAt = Date.now() + COOKIE_MAX_AGE * 1000;
  const payload = JSON.stringify({ exp: expiresAt });
  const token = signToken(payload);

  const cookieStore = await cookies();
  cookieStore.set(SYSTEM_ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // 'lax' allows the cookie to be sent on top-level navigations from
    // external links while still protecting against CSRF.
    sameSite: 'lax',
    // Path must be '/' so the cookie is sent on both /system/** UI routes
    // AND /api/** route handlers (e.g. POST /api/system/manual).
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  logger.info({ msg: 'System admin authenticated successfully' });
  return { success: true };
}

/**
 * Clears the system-admin cookie (logout).
 */
export async function logoutSystemAdmin(): Promise<void> {
  const cookieStore = await cookies();
  // Delete with the same path used when the cookie was set
  cookieStore.delete({ name: SYSTEM_ADMIN_COOKIE, path: '/' });
}

// ── Data Fetching Actions ────────────────────────────────────────────────────

export interface SystemUserRow {
  id: string;
  email: string;
  /** Null for an identity with no (active) organization membership. */
  role: string | null;
  authProvider: string;
  emailVerified: boolean;
  createdAt: Date;
  organizationId: string | null;
  organizationName: string | null;
  profile: {
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
  } | null;
  _count: {
    courses: number;
    enrollments: number;
    documents: number;
    notifications: number;
  };
}

export async function getAllUsers(options: {
  page?: number;
  limit?: number;
  search?: string;
  roleFilter?: string;
  orgFilter?: string;
}): Promise<{
  users: SystemUserRow[];
  total: number;
  page: number;
  totalPages: number;
  organizations: { id: string; name: string }[];
}> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const search = options.search?.trim() || '';
  const roleFilter = options.roleFilter || '';
  const orgFilter = options.orgFilter || '';

  const where: Prisma.UserWhereInput = {};
  // Role/org are now membership attributes, not identity attributes — filter
  // through the user's active memberships.
  if (roleFilter || orgFilter) {
    where.organizationMemberships = {
      some: {
        active: true,
        ...(roleFilter ? { role: roleFilter as UserRole } : {}),
        ...(orgFilter ? { organizationId: orgFilter } : {}),
      },
    };
  }
  if (search.length >= 2) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { fullName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [users, total, organizations] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        authProvider: true,
        emailVerified: true,
        createdAt: true,
        firstName: true,
        lastName: true,
        fullName: true,
        avatarUrl: true,
        organizationMemberships: {
          where: { active: true },
          select: {
            role: true,
            organizationId: true,
            organization: { select: { name: true } },
            _count: {
              select: {
                createdCourses: true,
                enrollments: true,
                documents: true,
                notifications: true,
              },
            },
          },
          orderBy: { joinedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
    prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Every identity is listed once. Most today hold exactly one membership; a
  // multi-org identity is represented here by its most recently joined active
  // membership, with activity counts summed across all of them — a
  // system-admin overview simplification, not an authorization decision.
  const mappedUsers: SystemUserRow[] = users.map((u) => {
    const primary = u.organizationMemberships[0];
    const totals = u.organizationMemberships.reduce(
      (acc, m) => ({
        courses: acc.courses + m._count.createdCourses,
        enrollments: acc.enrollments + m._count.enrollments,
        documents: acc.documents + m._count.documents,
        notifications: acc.notifications + m._count.notifications,
      }),
      { courses: 0, enrollments: 0, documents: 0, notifications: 0 },
    );

    return {
      id: u.id,
      email: u.email,
      role: primary?.role ?? null,
      authProvider: u.authProvider,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
      organizationId: primary?.organizationId ?? null,
      organizationName: primary?.organization.name ?? null,
      profile: {
        fullName: u.fullName,
        firstName: u.firstName,
        lastName: u.lastName,
        avatarUrl: u.avatarUrl,
      },
      _count: totals,
    };
  });

  return {
    users: mappedUsers,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    organizations,
  };
}

// ── User Detail ──────────────────────────────────────────────────────────────

export interface SystemUserDetail {
  id: string;
  email: string;
  /** Null for an identity with no membership at all. */
  role: string | null;
  authProvider: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  profile: {
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    avatarUrl: string | null;
  } | null;
  courses: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    _count: { enrollments: number; lessons: number };
  }>;
  enrollments: Array<{
    id: string;
    status: string;
    progress: number;
    score: number | null;
    startedAt: Date;
    completedAt: Date | null;
    course: { id: string; title: string; thumbnail: string | null };
  }>;
  documents: Array<{
    id: string;
    filename: string;
    originalName: string;
    size: number;
    createdAt: Date;
  }>;
  _count: {
    courses: number;
    enrollments: number;
    documents: number;
    notifications: number;
  };
}

export async function getUserDetail(userId: string): Promise<SystemUserDetail | null> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      authProvider: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
      firstName: true,
      lastName: true,
      fullName: true,
      avatarUrl: true,
    },
  });

  if (!user) return null;

  // Representative membership for this identity — most recently joined,
  // active or not (a system-admin debug view benefits from seeing a
  // deactivated membership too, unlike the roster-facing `getAllUsers`).
  const membership = await prisma.organizationUser.findFirst({
    where: { userId },
    select: {
      role: true,
      jobTitle: true,
      organization: { select: { id: true, name: true, slug: true } },
      createdCourses: {
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          _count: { select: { enrollments: true, lessons: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      enrollments: {
        select: {
          id: true,
          status: true,
          progress: true,
          score: true,
          startedAt: true,
          completedAt: true,
          course: { select: { id: true, title: true, thumbnail: true } },
        },
        orderBy: { startedAt: 'desc' },
      },
      documents: {
        select: {
          id: true,
          filename: true,
          originalName: true,
          size: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      _count: {
        select: {
          createdCourses: true,
          enrollments: true,
          documents: true,
          notifications: true,
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });

  return {
    id: user.id,
    email: user.email,
    role: membership?.role ?? null,
    authProvider: user.authProvider,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    organization: membership?.organization ?? null,
    profile: {
      fullName: user.fullName,
      firstName: user.firstName,
      lastName: user.lastName,
      jobTitle: membership?.jobTitle ?? null,
      avatarUrl: user.avatarUrl,
    },
    courses: membership?.createdCourses ?? [],
    enrollments: membership?.enrollments ?? [],
    documents: membership?.documents ?? [],
    _count: membership
      ? {
          courses: membership._count.createdCourses,
          enrollments: membership._count.enrollments,
          documents: membership._count.documents,
          notifications: membership._count.notifications,
        }
      : { courses: 0, enrollments: 0, documents: 0, notifications: 0 },
  };
}

// ── Delete Preview ───────────────────────────────────────────────────────────

export interface DeletePreview {
  user: {
    id: string;
    email: string;
    role: string;
    name: string;
  };
  counts: {
    courses: number;
    enrollments: number;
    documents: number;
    notifications: number;
    jobs: number;
    invites: number;
    verificationTokens: number;
    // Cascade counts (not directly on User but will be removed)
    lessons: number;
    quizzes: number;
    quizAttempts: number;
  };
  /** Other users enrolled in courses created by this user */
  affectedEnrollments: number;
}

export async function getUserDeletePreview(userId: string): Promise<DeletePreview | null> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true },
  });

  if (!user) return null;

  // An identity's activity spans every organization it belongs to.
  const orgUsers = await prisma.organizationUser.findMany({
    where: { userId },
    select: { id: true, role: true },
  });
  const orgUserIds = orgUsers.map((ou) => ou.id);

  const name = user.fullName || user.email.split('@')[0];

  // Count direct relations
  const [
    courseCount,
    enrollmentCount,
    documentCount,
    notificationCount,
    jobCount,
    inviteCount,
    verificationTokenCount,
  ] = await Promise.all([
    prisma.course.count({ where: { createdByOrgUserId: { in: orgUserIds } } }),
    prisma.enrollment.count({ where: { organizationUserId: { in: orgUserIds } } }),
    prisma.document.count({ where: { organizationUserId: { in: orgUserIds } } }),
    prisma.notification.count({ where: { organizationUserId: { in: orgUserIds } } }),
    prisma.job.count({ where: { userId } }),
    prisma.invite.count({ where: { email: user.email } }),
    prisma.verificationToken.count({ where: { identifier: user.email } }),
  ]);

  // Count cascade relations through courses
  const userCourses = await prisma.course.findMany({
    where: { createdByOrgUserId: { in: orgUserIds } },
    select: { id: true },
  });
  const courseIds = userCourses.map((c) => c.id);

  const [lessonCount, quizCount, quizAttemptCount, affectedEnrollments] = await Promise.all([
    courseIds.length > 0 ? prisma.lesson.count({ where: { courseId: { in: courseIds } } }) : 0,
    courseIds.length > 0
      ? prisma.quiz.count({ where: { lesson: { courseId: { in: courseIds } } } })
      : 0,
    enrollmentCount > 0
      ? prisma.quizAttempt.count({
          where: { enrollment: { organizationUserId: { in: orgUserIds } } },
        })
      : 0,
    courseIds.length > 0
      ? prisma.enrollment.count({
          where: {
            courseId: { in: courseIds },
            organizationUserId: { notIn: orgUserIds },
          },
        })
      : 0,
  ]);

  return {
    user: { id: user.id, email: user.email, role: orgUsers[0]?.role ?? 'n/a', name },
    counts: {
      courses: courseCount,
      enrollments: enrollmentCount,
      documents: documentCount,
      notifications: notificationCount,
      jobs: jobCount,
      invites: inviteCount,
      verificationTokens: verificationTokenCount,
      lessons: lessonCount,
      quizzes: quizCount,
      quizAttempts: quizAttemptCount,
    },
    affectedEnrollments,
  };
}

// ── Delete User ──────────────────────────────────────────────────────────────

export async function deleteUserWithRelations(
  userId: string,
): Promise<{ success: boolean; error?: string; deletedCounts?: Record<string, number> }> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    logger.info({ msg: 'System admin: deleting user', email: user.email, userId: user.id });

    const result = await prisma.$transaction(async (tx) => {
      const counts: Record<string, number> = {};

      const orgUsers = await tx.organizationUser.findMany({
        where: { userId },
        select: { id: true },
      });
      const orgUserIds = orgUsers.map((ou) => ou.id);

      // 1. Delete quiz attempts for the identity's enrollments (every org)
      const quizAttempts = await tx.quizAttempt.deleteMany({
        where: { enrollment: { organizationUserId: { in: orgUserIds } } },
      });
      counts.quizAttempts = quizAttempts.count;

      // 2. Delete enrollments for the identity (every org)
      const enrollments = await tx.enrollment.deleteMany({
        where: { organizationUserId: { in: orgUserIds } },
      });
      counts.enrollments = enrollments.count;

      // 3. Find courses created by any of the identity's memberships and
      // delete enrollments in those courses from other users
      const userCourses = await tx.course.findMany({
        where: { createdByOrgUserId: { in: orgUserIds } },
        select: { id: true },
      });
      const courseIds = userCourses.map((c) => c.id);

      if (courseIds.length > 0) {
        // Delete quiz attempts for other users' enrollments in these courses
        const otherQuizAttempts = await tx.quizAttempt.deleteMany({
          where: {
            enrollment: { courseId: { in: courseIds } },
          },
        });
        counts.otherQuizAttempts = otherQuizAttempts.count;

        // Delete other users' enrollments in these courses
        const otherEnrollments = await tx.enrollment.deleteMany({
          where: { courseId: { in: courseIds } },
        });
        counts.otherEnrollments = otherEnrollments.count;

        // 4. Delete courses (cascades: CourseArtifact, CourseVersion, Lesson→Quiz→Question)
        const courses = await tx.course.deleteMany({
          where: { createdByOrgUserId: { in: orgUserIds } },
        });
        counts.courses = courses.count;
      }

      // 5. Delete documents (cascades: DocumentVersion→PhiReport, MappingEvidence, CourseVersion)
      const documents = await tx.document.deleteMany({
        where: { organizationUserId: { in: orgUserIds } },
      });
      counts.documents = documents.count;

      // 6. Delete notifications
      const notifications = await tx.notification.deleteMany({
        where: { organizationUserId: { in: orgUserIds } },
      });
      counts.notifications = notifications.count;

      // 7. Delete jobs
      const jobs = await tx.job.deleteMany({
        where: { userId },
      });
      counts.jobs = jobs.count;

      // 8. Delete invites for user's email
      const invites = await tx.invite.deleteMany({
        where: { email: user.email },
      });
      counts.invites = invites.count;

      // 9. Delete verification tokens
      const tokens = await tx.verificationToken.deleteMany({
        where: { identifier: user.email },
      });
      counts.verificationTokens = tokens.count;

      // 10. Delete the user — cascades every OrganizationUser membership (now
      // safe: their authored courses were removed above), MfaFactor and
      // MfaRecoveryCode rows.
      await tx.user.delete({ where: { id: userId } });
      counts.user = 1;

      return counts;
    });

    logger.info({ msg: 'System admin: user deleted', email: user.email, counts: result });

    revalidatePath('/system');
    revalidatePath('/system/users');

    return { success: true, deletedCounts: result };
  } catch (error) {
    logger.error({ msg: 'System admin: failed to delete user', userId, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete user',
    };
  }
}

/**
 * Check if system admin is enabled (env var is set).
 * Used by the layout to decide whether to show 404.
 */
export async function isSystemAdminEnabled(): Promise<boolean> {
  return !!getSystemPassword();
}

/**
 * Check if the current request has a valid system-admin session.
 * Used by pages and server actions for conditional rendering/authorization.
 */
export async function checkSystemAuth(): Promise<boolean> {
  return verifySystemAdminCookie();
}
