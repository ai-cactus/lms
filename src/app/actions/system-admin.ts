'use server';

import prisma from '@/lib/prisma';
import { rawPrisma } from '@/db/index';
import { cookies, headers } from 'next/headers';
import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { audit, auditCritical, getClientContext } from '@/lib/audit';
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

// ── Asset Custody ────────────────────────────────────────────────────────────

/**
 * Seniority order used to pick the member who inherits a deleted account's
 * authored courses and uploaded documents. A worker is only ever chosen when no
 * manager-category member survives, because inheriting custody must not be
 * allowed to fail and strand the organization's training.
 */
const CUSTODIAN_ROLE_PRECEDENCE: readonly UserRole[] = [
  'owner',
  'admin',
  'hr',
  'clinical_director',
  'supervisor',
  'finance',
];

/**
 * The surviving member who takes custody of an account's authored records.
 *
 * Courses and documents belong to the ORGANIZATION (Q25);
 * `Course.createdByOrgUserId` and `Document.organizationUserId` record who
 * authored or uploaded them, nothing more. So deleting a person must not take
 * the org's training with them — but the row still has to point at a membership
 * that exists: `Course.creator` is `onDelete: Restrict` (the delete would be
 * refused) and `Document.organizationUser` is `onDelete: Cascade` (the document
 * would be destroyed, which is exactly what Q24 forbids). Custody therefore
 * moves to another member of the SAME organization, which is also what keeps a
 * platform-authored global course serving the other tenants using it.
 *
 * Active members outrank deactivated ones, then role seniority, then the
 * longest-standing membership — so the choice is deterministic rather than
 * dependent on row order. Returns null when the account is the organization's
 * last member, which refuses the delete instead of destroying the assets — and
 * that refusal is what protects the shared catalogue: the identity that authors
 * every `isGlobal` course (`getOrCreateSystemUser`) exclusively occupies the
 * internal System organization, so it can never be deleted out from under the
 * tenants consuming those courses.
 */
async function findAssetCustodian(
  client: Prisma.TransactionClient,
  organizationId: string,
  departingOrgUserIds: string[],
): Promise<{ id: string; role: UserRole } | null> {
  const candidates = await client.organizationUser.findMany({
    where: { organizationId, id: { notIn: departingOrgUserIds } },
    select: { id: true, role: true, active: true, joinedAt: true },
  });

  if (candidates.length === 0) return null;

  const seniority = (role: UserRole) => {
    const index = CUSTODIAN_ROLE_PRECEDENCE.indexOf(role);
    return index === -1 ? CUSTODIAN_ROLE_PRECEDENCE.length : index;
  };

  return candidates.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      seniority(a.role) - seniority(b.role) ||
      a.joinedAt.getTime() - b.joinedAt.getTime(),
  )[0];
}

// ── Delete Preview ───────────────────────────────────────────────────────────

export interface DeletePreview {
  user: {
    id: string;
    email: string;
    role: string;
    name: string;
  };
  /** Records the hard delete destroys. */
  counts: {
    enrollments: number;
    quizAttempts: number;
    /** Compliance records, destroyed with the enrollments they hang off. */
    certificates: number;
    notifications: number;
    jobs: number;
    invites: number;
    verificationTokens: number;
  };
  /** Records the delete leaves intact — organization assets and other members' history. */
  retained: {
    /** Authored courses, transferred to a surviving member rather than deleted. */
    courses: number;
    /** Uploaded documents, transferred to a surviving member rather than deleted. */
    documents: number;
    /** Enrollments other members hold in courses this user authored. */
    otherEnrollments: number;
    /**
     * Organizations where this account holds assets but no other member
     * survives to inherit them. Non-empty means the delete will be refused.
     */
    organizationsWithoutCustodian: string[];
  };
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
    select: {
      id: true,
      role: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  });
  const orgUserIds = orgUsers.map((ou) => ou.id);

  const name = user.fullName || user.email.split('@')[0];

  const [
    enrollmentCount,
    certificateCount,
    notificationCount,
    jobCount,
    inviteCount,
    verificationTokenCount,
    quizAttemptCount,
  ] = await Promise.all([
    prisma.enrollment.count({ where: { organizationUserId: { in: orgUserIds } } }),
    prisma.certificate.count({ where: { organizationUserId: { in: orgUserIds } } }),
    prisma.notification.count({ where: { organizationUserId: { in: orgUserIds } } }),
    prisma.job.count({ where: { userId } }),
    prisma.invite.count({ where: { email: user.email } }),
    prisma.verificationToken.count({ where: { identifier: user.email } }),
    prisma.quizAttempt.count({
      where: { enrollment: { organizationUserId: { in: orgUserIds } } },
    }),
  ]);

  // ⛔ `rawPrisma` for the two archivable models: Q24 retains archived courses
  // and documents, and the delete moves custody of those too. Counting through
  // the filtered client would under-report what changes hands on the very
  // screen whose job is to report exactly that.
  const [authoredCourses, uploadedDocuments] = await Promise.all([
    rawPrisma.course.findMany({
      where: { createdByOrgUserId: { in: orgUserIds } },
      select: { id: true, createdByOrgUserId: true },
    }),
    rawPrisma.document.findMany({
      where: { organizationUserId: { in: orgUserIds } },
      select: { organizationUserId: true },
    }),
  ]);

  const courseIds = authoredCourses.map((c) => c.id);

  const otherEnrollments =
    courseIds.length > 0
      ? await prisma.enrollment.count({
          where: {
            courseId: { in: courseIds },
            organizationUserId: { notIn: orgUserIds },
          },
        })
      : 0;

  const membershipsHoldingAssets = new Set<string>([
    ...authoredCourses.map((c) => c.createdByOrgUserId),
    ...uploadedDocuments.map((d) => d.organizationUserId),
  ]);

  const organizationsWithoutCustodian: string[] = [];
  for (const orgUser of orgUsers) {
    if (!membershipsHoldingAssets.has(orgUser.id)) continue;
    const custodian = await findAssetCustodian(rawPrisma, orgUser.organizationId, orgUserIds);
    if (!custodian) organizationsWithoutCustodian.push(orgUser.organization.name);
  }

  return {
    user: { id: user.id, email: user.email, role: orgUsers[0]?.role ?? 'n/a', name },
    counts: {
      enrollments: enrollmentCount,
      quizAttempts: quizAttemptCount,
      certificates: certificateCount,
      notifications: notificationCount,
      jobs: jobCount,
      invites: inviteCount,
      verificationTokens: verificationTokenCount,
    },
    retained: {
      courses: authoredCourses.length,
      documents: uploadedDocuments.length,
      otherEnrollments,
      organizationsWithoutCustodian,
    },
  };
}

// ── Delete User ──────────────────────────────────────────────────────────────

export async function deleteUserWithRelations(userId: string): Promise<{
  success: boolean;
  error?: string;
  deletedCounts?: Record<string, number>;
  transferredCounts?: Record<string, number>;
}> {
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

    // Resolved before opening the transaction: headers() is request-scoped and
    // must not be awaited inside a transaction callback.
    const clientContext = await systemClientContext();

    // ⛔ `rawPrisma.$transaction`, so every `tx.*` below is UN-filtered. Q24
    // retains archived courses and documents, and custody of those has to move
    // as well: filtered, an archived course would keep pointing at the
    // membership about to be deleted and `Course.creator`'s Restrict would
    // block the delete, while an archived document's Cascade would destroy a
    // row Q24 says must be kept.
    const result = await rawPrisma.$transaction(async (tx) => {
      const deleted: Record<string, number> = {};
      const transferred: Record<string, number> = { courses: 0, documents: 0 };

      const orgUsers = await tx.organizationUser.findMany({
        where: { userId },
        select: { id: true, organizationId: true },
      });
      const orgUserIds = orgUsers.map((ou) => ou.id);

      // 1. Hand the organization's assets to a surviving member BEFORE anything
      // is destroyed. A course is never hard-deleted as a side effect of
      // deleting its author, and never archived either: archiving withdraws it
      // from every list, and losing the author is not a reason to stop offering
      // the org's training. A platform-authored global course is being consumed
      // by other tenants entirely, so it must survive untouched as well.
      for (const orgUser of orgUsers) {
        const authoredCourses = await tx.course.count({
          where: { createdByOrgUserId: orgUser.id },
        });
        const uploadedDocuments = await tx.document.count({
          where: { organizationUserId: orgUser.id },
        });

        if (authoredCourses === 0 && uploadedDocuments === 0) continue;

        const custodian = await findAssetCustodian(tx, orgUser.organizationId, orgUserIds);

        if (!custodian) {
          logger.warn({
            msg: '[system] User delete refused: no surviving member to inherit org assets',
            userId,
            orgId: orgUser.organizationId,
            authoredCourses,
            uploadedDocuments,
          });
          throw new Error(
            'This user authored courses or uploaded documents in an organization with no other member to inherit them. Add a member, or delete the organization, before deleting this user.',
          );
        }

        const movedCourses = await tx.course.updateMany({
          where: { createdByOrgUserId: orgUser.id },
          data: { createdByOrgUserId: custodian.id },
        });
        const movedDocuments = await tx.document.updateMany({
          where: { organizationUserId: orgUser.id },
          data: { organizationUserId: custodian.id },
        });

        transferred.courses += movedCourses.count;
        transferred.documents += movedDocuments.count;

        logger.info({
          msg: '[system] Transferred authored records to a surviving member',
          orgId: orgUser.organizationId,
          custodianOrgUserId: custodian.id,
          custodianRole: custodian.role,
          courses: movedCourses.count,
          documents: movedDocuments.count,
        });
      }

      // 2. The identity's OWN learning history (every org). Certificates hang
      // off the enrollment with `onDelete: Cascade`, so they go with it — a hard
      // delete of the identity cannot keep a compliance record that is keyed to
      // the membership being removed. Counted before the delete so the audit row
      // records what went. Enrollments, attempts and certificates belonging to
      // OTHER members — including in courses this user authored — are
      // deliberately never touched: their compliance history is not this
      // person's to destroy.
      deleted.certificates = await tx.certificate.count({
        where: { organizationUserId: { in: orgUserIds } },
      });

      const quizAttempts = await tx.quizAttempt.deleteMany({
        where: { enrollment: { organizationUserId: { in: orgUserIds } } },
      });
      deleted.quizAttempts = quizAttempts.count;

      const enrollments = await tx.enrollment.deleteMany({
        where: { organizationUserId: { in: orgUserIds } },
      });
      deleted.enrollments = enrollments.count;

      // 3. Delete notifications
      const notifications = await tx.notification.deleteMany({
        where: { organizationUserId: { in: orgUserIds } },
      });
      deleted.notifications = notifications.count;

      // 4. Delete jobs
      const jobs = await tx.job.deleteMany({
        where: { userId },
      });
      deleted.jobs = jobs.count;

      // 5. Delete invites for user's email
      const invites = await tx.invite.deleteMany({
        where: { email: user.email },
      });
      deleted.invites = invites.count;

      // 6. Delete verification tokens
      const tokens = await tx.verificationToken.deleteMany({
        where: { identifier: user.email },
      });
      deleted.verificationTokens = tokens.count;

      // 7. Delete the user — cascades every OrganizationUser membership (now
      // safe: the courses and documents they authored point at a surviving
      // member), MfaFactor and MfaRecoveryCode rows.
      await tx.user.delete({ where: { id: userId } });
      deleted.user = 1;

      // F-094: the most destructive action in the system — an irreversible
      // cross-organization hard delete of a person and all their enrollments,
      // attempts, certificates and attestations. auditCritical INSIDE the
      // transaction, so the deletion and its record commit together: there can
      // be no unexplained disappearance of a user's compliance history. If the
      // audit write fails, the delete correctly rolls back.
      await auditCritical(
        {
          action: 'system.user.delete',
          targetType: 'user',
          targetId: userId,
          // Counts only — no email, no names. The logger redacts PII anyway,
          // but the audit row is long-lived so it carries even less.
          metadata: { deletedCounts: deleted, transferredCounts: transferred },
          ...clientContext,
        },
        tx,
      );

      return { deleted, transferred };
    });

    logger.info({
      msg: 'System admin: user deleted',
      email: user.email,
      counts: result.deleted,
      transferred: result.transferred,
    });

    revalidatePath('/system');
    revalidatePath('/system/users');

    return {
      success: true,
      deletedCounts: result.deleted,
      transferredCounts: result.transferred,
    };
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
