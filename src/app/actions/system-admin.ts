'use server';

import prisma from '@/lib/prisma';
import { rawPrisma } from '@/db/index';
import { cookies, headers } from 'next/headers';
import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import {
  describeOwnershipBlocks,
  findOwnershipBlocks,
  softDeleteUser,
} from '@/lib/system/delete-user';
import {
  previewOrganizationRestore,
  previewOrganizationSoftDelete,
  restoreOrganization as restoreOrganizationRecord,
  softDeleteOrganization,
  type OrganizationRestorePreview,
  type OrganizationSoftDeletePreview,
} from '@/lib/system/delete-organization';
import { audit, getClientContext } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
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

/**
 * Constant-time password comparison (F-056).
 *
 * A plain `===` short-circuits on the first differing byte, so response timing
 * leaks how much of the password a guess got right — which turns brute-forcing a
 * shared secret from 62^n into roughly 62*n work. Length is compared first and
 * separately because timingSafeEqual throws on differing lengths; leaking the
 * length alone is not materially useful.
 */
function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Audit context for system-admin events (F-094).
 *
 * `actorRole: 'system_admin'` is recorded, but deliberately no `actorId`: this
 * surface authenticates with a SHARED static password (F-056), so the trail can
 * establish that someone holding it acted, and when, and from where — but not
 * who. IP and user-agent are the only identifying signals available until real
 * per-admin accounts exist. Do not invent an actorId here; a fabricated
 * attribution is worse than an honest gap.
 */
async function systemClientContext() {
  return {
    actorRole: 'system_admin',
    ...getClientContext(await headers()),
  };
}

/**
 * Shared throttle for the console's destructive actions. Fail-closed for the
 * same reason the console login is: a Redis outage must not open an unmetered
 * window on irreversible cross-tenant writes. Returns the refusal, or null.
 */
async function destructiveActionRateLimitRefusal(): Promise<string | null> {
  const ip = getClientContext(await headers()).ip ?? 'unknown';
  const { allowed, resetInSeconds } = await checkRateLimit(
    `system-admin-destructive:${ip}`,
    10,
    900,
    { failClosed: true },
  );
  if (allowed) return null;
  logger.warn({ msg: '[system] Destructive action rate limit exceeded', ip });
  return `Too many attempts. Please wait ${resetInSeconds} seconds and try again.`;
}

// ── Auth Action ──────────────────────────────────────────────────────────────

export async function verifySystemPassword(
  password: string,
): Promise<{ success: boolean; error?: string }> {
  const systemPassword = getSystemPassword();
  if (!systemPassword) {
    return { success: false, error: 'System admin is not enabled' };
  }

  // F-097: this gate previously accepted UNLIMITED attempts against a single
  // shared static password (F-056), guarding cross-organization powers including
  // irreversible user deletion. It was the most brute-forceable surface in the
  // system.
  //
  // Deliberately tighter than the tenant login limiter (10 per 15 min): a
  // legitimate operator needs a handful of attempts, and there is no self-service
  // reset to lock anyone out of.
  //
  // failClosed on purpose. Everywhere else that is a trade-off; here it is not.
  // If Redis is unavailable, refusing platform-admin logins for a few minutes is
  // strictly better than opening an unmetered brute-force window on a shared
  // credential — the console is an operations tool, not a customer-facing path.
  const ip = getClientContext(await headers()).ip ?? 'unknown';
  const { allowed, resetInSeconds } = await checkRateLimit(`system-admin-login:${ip}`, 5, 900, {
    failClosed: true,
  });
  if (!allowed) {
    logger.warn({ msg: '[system] System admin login rate limit exceeded', ip });
    await audit({
      action: 'system.auth.rate_limited',
      ...(await systemClientContext()),
    });
    return {
      success: false,
      error: `Too many attempts. Please wait ${resetInSeconds} seconds and try again.`,
    };
  }

  if (!timingSafeEquals(password, systemPassword)) {
    logger.warn({ msg: 'System admin login failed: wrong password' });
    // F-094: this is the entry point to cross-organization super-admin powers,
    // so a failed attempt is exactly what a reviewer needs to see. Best-effort
    // rather than critical: a failing audit sink must not make the login
    // endpoint unusable, and a genuine attacker is not deterred by a 500.
    await audit({
      action: 'system.auth.failure',
      ...(await systemClientContext()),
    });
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
  // F-094 + F-056: a successful super-admin session must be on the record. Note
  // there is no actorId to record — system-admin auth is a SHARED static
  // password, so the trail can prove that someone held it and when, but not
  // who. Real per-actor attribution needs the F-056 account model.
  await audit({
    action: 'system.auth.success',
    ...(await systemClientContext()),
  });
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
  /** Set when the identity has been deleted (Q-23 soft delete). */
  deletedAt: Date | null;
  organizationId: string | null;
  organizationName: string | null;
  profile: {
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  _count: {
    courses: number;
    enrollments: number;
    documents: number;
    notifications: number;
  };
}

export type SystemUserStatusFilter = 'active' | 'deleted' | 'all';

export async function getAllUsers(options: {
  page?: number;
  limit?: number;
  search?: string;
  roleFilter?: string;
  orgFilter?: string;
  /** Defaults to `active`: deleted identities are hidden unless asked for. */
  statusFilter?: SystemUserStatusFilter;
}): Promise<{
  users: SystemUserRow[];
  total: number;
  page: number;
  totalPages: number;
  /** Every organization, deleted ones included (flagged) so their users stay filterable. */
  organizations: { id: string; name: string; deletedAt: Date | null }[];
}> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const search = options.search?.trim() || '';
  const roleFilter = options.roleFilter || '';
  const orgFilter = options.orgFilter || '';
  const statusFilter: SystemUserStatusFilter = options.statusFilter ?? 'active';

  const where: Prisma.UserWhereInput = {};
  if (statusFilter === 'active') where.deletedAt = null;
  if (statusFilter === 'deleted') where.deletedAt = { not: null };
  // Role/org are membership attributes, not identity attributes — filter
  // through the user's active memberships. A deleted identity has none left,
  // so its deactivated memberships stand in: it must still be findable by the
  // organization it was deleted from.
  if (roleFilter || orgFilter) {
    where.organizationMemberships = {
      some: {
        OR: [{ active: true }, { user: { is: { deletedAt: { not: null } } } }],
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
        deletedAt: true,
        // Every membership, not just active ones: a deleted identity has only
        // deactivated memberships, and its retained records hang off them.
        organizationMemberships: {
          select: {
            active: true,
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
      select: { id: true, name: true, deletedAt: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Every identity is listed once. Most today hold exactly one membership; a
  // multi-org identity is represented here by its most recently joined active
  // membership, with activity counts summed across all of them — a
  // system-admin overview simplification, not an authorization decision. A
  // deleted identity is represented by the memberships it was deleted from, so
  // its retained records still show.
  const mappedUsers: SystemUserRow[] = users.map((u) => {
    const memberships = u.deletedAt
      ? u.organizationMemberships
      : u.organizationMemberships.filter((m) => m.active);
    const primary = memberships[0];
    const totals = memberships.reduce(
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
      deletedAt: u.deletedAt,
      organizationId: primary?.organizationId ?? null,
      organizationName: primary?.organization.name ?? null,
      profile: {
        fullName: u.fullName,
        firstName: u.firstName,
        lastName: u.lastName,
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
  /** Set when the identity has been deleted; the console then opens read-only. */
  deletedAt: Date | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  profile: {
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
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
    course: { id: string; title: string };
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
      deletedAt: true,
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
          course: { select: { id: true, title: true } },
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
    deletedAt: user.deletedAt,
    organization: membership?.organization ?? null,
    profile: {
      fullName: user.fullName,
      firstName: user.firstName,
      lastName: user.lastName,
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

/**
 * What deleting a user changes (Q-23). Nothing is destroyed: the delete removes
 * the person's ACCESS and keeps every record, so the preview reports what is
 * revoked and what is retained.
 */
export interface DeletePreview {
  user: {
    id: string;
    email: string;
    role: string;
    name: string;
  };
  /** Set when the identity is already deleted — the console offers no delete then. */
  deletedAt: Date | null;
  /**
   * Q-30: why the delete would be refused — the organizations it would leave
   * with no active owner or no active member. Null when the delete may proceed.
   */
  blockedReason: string | null;
  /** Access the delete removes. */
  revoked: {
    /** Organizations whose active membership is deactivated. */
    organizations: string[];
    /** Pending invites to this email from those organizations, expired. */
    pendingInvites: number;
  };
  /** Records the delete keeps, unchanged, for compliance. */
  retained: {
    enrollments: number;
    quizAttempts: number;
    certificates: number;
    /** Courses this user authored — they stay the organization's, authorship unchanged. */
    courses: number;
    /** Documents this user uploaded — they stay the organization's, authorship unchanged. */
    documents: number;
    /** Other active members who report to this user; their manager link is kept. */
    directReports: number;
  };
}

export async function getUserDeletePreview(userId: string): Promise<DeletePreview | null> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, deletedAt: true },
  });

  if (!user) return null;

  // An identity's activity spans every organization it belongs to.
  const orgUsers = await prisma.organizationUser.findMany({
    where: { userId },
    select: {
      id: true,
      role: true,
      active: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
    orderBy: [{ active: 'desc' }, { joinedAt: 'desc' }],
  });
  const orgUserIds = orgUsers.map((ou) => ou.id);

  // ⛔ `rawPrisma` for the two archivable models: archived courses and documents
  // are retained records too, and the filtered client would under-report them
  // on the screen whose job is to say what is kept.
  const [
    enrollments,
    quizAttempts,
    certificates,
    directReports,
    pendingInvites,
    courses,
    documents,
  ] = await Promise.all([
    prisma.enrollment.count({ where: { organizationUserId: { in: orgUserIds } } }),
    prisma.quizAttempt.count({
      where: { enrollment: { organizationUserId: { in: orgUserIds } } },
    }),
    prisma.certificate.count({ where: { organizationUserId: { in: orgUserIds } } }),
    prisma.organizationUser.count({
      where: { managerId: { in: orgUserIds }, id: { notIn: orgUserIds }, active: true },
    }),
    prisma.invite.count({
      where: {
        email: { equals: user.email, mode: 'insensitive' },
        organizationId: { in: orgUsers.map((ou) => ou.organizationId) },
        status: 'pending',
      },
    }),
    rawPrisma.course.count({ where: { createdByOrgUserId: { in: orgUserIds } } }),
    rawPrisma.document.count({ where: { organizationUserId: { in: orgUserIds } } }),
  ]);
  const ownershipBlocks = await findOwnershipBlocks(prisma, userId);

  return {
    user: {
      id: user.id,
      email: user.email,
      role: orgUsers[0]?.role ?? 'n/a',
      name: user.fullName || user.email.split('@')[0],
    },
    deletedAt: user.deletedAt,
    blockedReason: ownershipBlocks.length > 0 ? describeOwnershipBlocks(ownershipBlocks) : null,
    revoked: {
      organizations: orgUsers.filter((ou) => ou.active).map((ou) => ou.organization.name),
      pendingInvites,
    },
    retained: { enrollments, quizAttempts, certificates, courses, documents, directReports },
  };
}

// ── Delete User ──────────────────────────────────────────────────────────────

/**
 * Soft-deletes a user (Q-23) through the shared {@link softDeleteUser}: access
 * to every organization is removed and sign-in is refused everywhere, while
 * certificates, enrolments, quiz attempts and authored content are kept.
 */
export async function deleteUserWithRelations(userId: string): Promise<{
  success: boolean;
  error?: string;
  membershipsDeactivated?: number;
}> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  try {
    const result = await softDeleteUser(userId, await systemClientContext());

    if (result.status === 'not_found') {
      return { success: false, error: 'User not found' };
    }
    if (result.status === 'already_deleted') {
      return {
        success: false,
        error: `This user was already deleted on ${result.deletedAt.toISOString().slice(0, 10)}.`,
      };
    }
    if (result.status === 'blocked') {
      return { success: false, error: result.message };
    }

    revalidatePath('/system');
    revalidatePath(`/system/users/${userId}`);

    return { success: true, membershipsDeactivated: result.membershipsDeactivated };
  } catch (error) {
    logger.error({ msg: '[system] Failed to delete user', userId, err: error });
    return { success: false, error: 'Failed to delete user. Please try again.' };
  }
}

// ── Organizations ────────────────────────────────────────────────────────────

export type SystemOrganizationStatusFilter = 'active' | 'deleted' | 'all';

export interface SystemOrganizationRow {
  id: string;
  name: string;
  slug: string;
  deletedAt: Date | null;
  createdAt: Date;
  /** Active memberships. A deleted organization has none. */
  memberCount: number;
  ownerCount: number;
  facilityCount: number;
  subscription: { plan: string; status: string } | null;
}

export async function getAllOrganizations(options: {
  page?: number;
  limit?: number;
  search?: string;
  /** Defaults to `active`: deleted organizations are hidden unless asked for. */
  statusFilter?: SystemOrganizationStatusFilter;
}): Promise<{
  organizations: SystemOrganizationRow[];
  total: number;
  page: number;
  totalPages: number;
}> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const search = options.search?.trim() || '';
  const statusFilter: SystemOrganizationStatusFilter = options.statusFilter ?? 'active';

  const where: Prisma.OrganizationWhereInput = {};
  if (statusFilter === 'active') where.deletedAt = null;
  if (statusFilter === 'deleted') where.deletedAt = { not: null };
  if (search.length >= 2) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [organizations, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        deletedAt: true,
        createdAt: true,
        subscription: { select: { plan: true, status: true } },
        _count: {
          select: {
            organizationUsers: { where: { active: true } },
            facilities: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.organization.count({ where }),
  ]);

  const ownerCounts = await prisma.organizationUser.groupBy({
    by: ['organizationId'],
    where: {
      organizationId: { in: organizations.map((org) => org.id) },
      active: true,
      role: 'owner',
    },
    _count: { _all: true },
  });
  const ownersByOrg = new Map(ownerCounts.map((row) => [row.organizationId, row._count._all]));

  return {
    organizations: organizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      deletedAt: org.deletedAt,
      createdAt: org.createdAt,
      memberCount: org._count.organizationUsers,
      ownerCount: ownersByOrg.get(org.id) ?? 0,
      facilityCount: org._count.facilities,
      subscription: org.subscription,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

/** Members shown on the organization detail page; the total is reported separately. */
const ORGANIZATION_DETAIL_MEMBER_LIMIT = 200;

export interface SystemOrganizationDetail {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  /** Set when the organization is soft-deleted; the console then opens read-only. */
  deletedAt: Date | null;
  memberTotal: number;
  members: Array<{
    organizationUserId: string;
    userId: string;
    name: string | null;
    email: string;
    role: string;
    active: boolean;
    deactivatedAt: Date | null;
    /** Set when the person's identity has been deleted (Q-23). */
    userDeletedAt: Date | null;
  }>;
  facilities: Array<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
  }>;
  subscription: {
    plan: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date;
  } | null;
}

export async function getOrganizationDetail(
  organizationId: string,
): Promise<SystemOrganizationDetail | null> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      deletedAt: true,
      subscription: {
        select: { plan: true, status: true, cancelAtPeriodEnd: true, currentPeriodEnd: true },
      },
      facilities: {
        select: { id: true, name: true, city: true, state: true },
        orderBy: { createdAt: 'asc' },
      },
      organizationUsers: {
        select: {
          id: true,
          role: true,
          active: true,
          deactivatedAt: true,
          user: { select: { id: true, email: true, fullName: true, deletedAt: true } },
        },
        orderBy: [{ active: 'desc' }, { joinedAt: 'asc' }],
        take: ORGANIZATION_DETAIL_MEMBER_LIMIT,
      },
      _count: { select: { organizationUsers: true } },
    },
  });

  if (!organization) return null;

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
    deletedAt: organization.deletedAt,
    memberTotal: organization._count.organizationUsers,
    members: organization.organizationUsers.map((membership) => ({
      organizationUserId: membership.id,
      userId: membership.user.id,
      name: membership.user.fullName,
      email: membership.user.email,
      role: membership.role,
      active: membership.active,
      deactivatedAt: membership.deactivatedAt,
      userDeletedAt: membership.user.deletedAt,
    })),
    facilities: organization.facilities,
    subscription: organization.subscription,
  };
}

export async function getOrganizationDeletePreview(
  organizationId: string,
): Promise<OrganizationSoftDeletePreview | null> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }
  return previewOrganizationSoftDelete(organizationId);
}

export async function getOrganizationRestorePreview(
  organizationId: string,
): Promise<OrganizationRestorePreview | null> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }
  return previewOrganizationRestore(organizationId);
}

/** The word typed, alongside the organization's exact name, to confirm a delete. */
const ORGANIZATION_DELETE_CONFIRM_WORD = 'DELETE';

function revalidateOrganizationPages(organizationId: string): void {
  revalidatePath('/system');
  revalidatePath('/system/organizations');
  revalidatePath(`/system/organizations/${organizationId}`);
}

/**
 * Soft-deletes an organization through the shared {@link softDeleteOrganization}:
 * every member loses access, every record is kept, billing is untouched.
 * The typed confirmation is re-validated here — the client check is a
 * convenience, not the gate.
 */
export async function deleteOrganization(
  organizationId: string,
  confirmation: { confirmName: string; confirmWord: string },
): Promise<{ success: boolean; error?: string; membershipsDeactivated?: number }> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  try {
    const rateLimitRefusal = await destructiveActionRateLimitRefusal();
    if (rateLimitRefusal) return { success: false, error: rateLimitRefusal };

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) return { success: false, error: 'Organization not found' };

    if (
      confirmation.confirmName !== organization.name ||
      confirmation.confirmWord !== ORGANIZATION_DELETE_CONFIRM_WORD
    ) {
      return {
        success: false,
        error: `Type the organization name and ${ORGANIZATION_DELETE_CONFIRM_WORD} exactly to confirm.`,
      };
    }

    const result = await softDeleteOrganization(organizationId, await systemClientContext());

    switch (result.status) {
      case 'not_found':
        return { success: false, error: 'Organization not found' };
      case 'already_deleted':
        return {
          success: false,
          error: `This organization was already deleted on ${result.deletedAt.toISOString().slice(0, 10)}.`,
        };
      case 'refused':
        return { success: false, error: result.message };
      case 'deleted':
        revalidateOrganizationPages(organizationId);
        return { success: true, membershipsDeactivated: result.membershipsDeactivated };
    }
  } catch (error) {
    logger.error({
      msg: '[system] Failed to delete organization',
      orgId: organizationId,
      err: error,
    });
    return { success: false, error: 'Failed to delete organization. Please try again.' };
  }
}

/**
 * Restores a soft-deleted organization: brings back exactly the members who
 * were active when it was deleted, except identities deleted since. Refused
 * when no active owner would result; allowed over the plan's seat limit.
 */
export async function restoreOrganization(
  organizationId: string,
): Promise<{ success: boolean; error?: string; membershipsReactivated?: number }> {
  if (!(await verifySystemAdminCookie())) {
    throw new Error('Unauthorized');
  }

  try {
    const rateLimitRefusal = await destructiveActionRateLimitRefusal();
    if (rateLimitRefusal) return { success: false, error: rateLimitRefusal };

    const result = await restoreOrganizationRecord(organizationId, await systemClientContext());

    switch (result.status) {
      case 'not_found':
        return { success: false, error: 'Organization not found' };
      case 'not_deleted':
        return { success: false, error: 'This organization is not deleted.' };
      case 'blocked':
        return { success: false, error: result.message };
      case 'restored':
        revalidateOrganizationPages(organizationId);
        return { success: true, membershipsReactivated: result.membershipsReactivated };
    }
  } catch (error) {
    logger.error({
      msg: '[system] Failed to restore organization',
      orgId: organizationId,
      err: error,
    });
    return { success: false, error: 'Failed to restore organization. Please try again.' };
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
