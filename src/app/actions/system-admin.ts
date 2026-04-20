'use server';

import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';

// ── Constants ────────────────────────────────────────────────────────────────
const COOKIE_NAME = 'system_admin_auth';
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

function verifyToken(token: string): boolean {
  const secret = getAuthSecret();
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Returns true if the current request carries a valid system-admin cookie.
 * Every protected server action calls this before doing any work.
 */
async function isAuthenticated(): Promise<boolean> {
  if (!getSystemPassword()) return false;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifyToken(token);
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
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/system',
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
  cookieStore.delete(COOKIE_NAME);
}

// ── Data Fetching Actions ────────────────────────────────────────────────────

export interface SystemUserRow {
  id: string;
  email: string;
  role: string;
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
  if (!(await isAuthenticated())) {
    throw new Error('Unauthorized');
  }

  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const search = options.search?.trim() || '';
  const roleFilter = options.roleFilter || '';
  const orgFilter = options.orgFilter || '';

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (roleFilter) {
    where.role = roleFilter;
  }
  if (orgFilter) {
    where.organizationId = orgFilter;
  }
  if (search.length >= 2) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { profile: { fullName: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [users, total, organizations] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        role: true,
        authProvider: true,
        emailVerified: true,
        createdAt: true,
        organizationId: true,
        organization: { select: { name: true } },
        profile: {
          select: { fullName: true, firstName: true, lastName: true, avatarUrl: true },
        },
        _count: {
          select: {
            courses: true,
            enrollments: true,
            documents: true,
            notifications: true,
          },
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

  const mappedUsers: SystemUserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    authProvider: u.authProvider,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
    organizationId: u.organizationId,
    organizationName: u.organization?.name ?? null,
    profile: u.profile
      ? {
          fullName: u.profile.fullName,
          firstName: u.profile.firstName,
          lastName: u.profile.lastName,
          avatarUrl: u.profile.avatarUrl,
        }
      : null,
    _count: u._count,
  }));

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
  role: string;
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
    companyName: string | null;
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
  if (!(await isAuthenticated())) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      authProvider: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
      organization: {
        select: { id: true, name: true, slug: true },
      },
      profile: {
        select: {
          fullName: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          companyName: true,
          avatarUrl: true,
        },
      },
      courses: {
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
          courses: true,
          enrollments: true,
          documents: true,
          notifications: true,
        },
      },
    },
  });

  if (!user) return null;

  return user as SystemUserDetail;
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
    profile: number;
    // Cascade counts (not directly on User but will be removed)
    lessons: number;
    quizzes: number;
    quizAttempts: number;
  };
  /** Other users enrolled in courses created by this user */
  affectedEnrollments: number;
}

export async function getUserDeletePreview(userId: string): Promise<DeletePreview | null> {
  if (!(await isAuthenticated())) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      profile: { select: { fullName: true } },
    },
  });

  if (!user) return null;

  const name = user.profile?.fullName || user.email.split('@')[0];

  // Count direct relations
  const [
    courseCount,
    enrollmentCount,
    documentCount,
    notificationCount,
    jobCount,
    inviteCount,
    verificationTokenCount,
    profileCount,
  ] = await Promise.all([
    prisma.course.count({ where: { createdBy: userId } }),
    prisma.enrollment.count({ where: { userId } }),
    prisma.document.count({ where: { userId } }),
    prisma.notification.count({ where: { userId } }),
    prisma.job.count({ where: { userId } }),
    prisma.invite.count({ where: { email: user.email } }),
    prisma.verificationToken.count({ where: { identifier: user.email } }),
    prisma.profile.count({ where: { id: userId } }),
  ]);

  // Count cascade relations through courses
  const userCourses = await prisma.course.findMany({
    where: { createdBy: userId },
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
          where: { enrollment: { userId } },
        })
      : 0,
    courseIds.length > 0
      ? prisma.enrollment.count({
          where: {
            courseId: { in: courseIds },
            userId: { not: userId },
          },
        })
      : 0,
  ]);

  return {
    user: { id: user.id, email: user.email, role: user.role, name },
    counts: {
      courses: courseCount,
      enrollments: enrollmentCount,
      documents: documentCount,
      notifications: notificationCount,
      jobs: jobCount,
      invites: inviteCount,
      verificationTokens: verificationTokenCount,
      profile: profileCount,
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
  if (!(await isAuthenticated())) {
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

      // 1. Delete quiz attempts for user's enrollments
      const quizAttempts = await tx.quizAttempt.deleteMany({
        where: { enrollment: { userId } },
      });
      counts.quizAttempts = quizAttempts.count;

      // 2. Delete enrollments for the user
      const enrollments = await tx.enrollment.deleteMany({
        where: { userId },
      });
      counts.enrollments = enrollments.count;

      // 3. Find courses created by user and delete enrollments in those courses from other users
      const userCourses = await tx.course.findMany({
        where: { createdBy: userId },
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
          where: { createdBy: userId },
        });
        counts.courses = courses.count;
      }

      // 5. Delete documents (cascades: DocumentVersion→PhiReport, MappingEvidence, CourseVersion)
      const documents = await tx.document.deleteMany({
        where: { userId },
      });
      counts.documents = documents.count;

      // 6. Delete notifications
      const notifications = await tx.notification.deleteMany({
        where: { userId },
      });
      counts.notifications = notifications.count;

      // 7. Delete jobs
      const jobs = await tx.job.deleteMany({
        where: { userId },
      });
      counts.jobs = jobs.count;

      // 8. Delete profile
      const profile = await tx.profile.deleteMany({
        where: { id: userId },
      });
      counts.profile = profile.count;

      // 9. Delete invites for user's email
      const invites = await tx.invite.deleteMany({
        where: { email: user.email },
      });
      counts.invites = invites.count;

      // 10. Delete verification tokens
      const tokens = await tx.verificationToken.deleteMany({
        where: { identifier: user.email },
      });
      counts.verificationTokens = tokens.count;

      // 11. Delete the user
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
 * Used by pages for conditional rendering.
 */
export async function checkSystemAuth(): Promise<boolean> {
  return isAuthenticated();
}
