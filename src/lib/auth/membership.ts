/**
 * Membership resolution — the seam between a global `User` identity and the
 * per-organization `OrganizationUser` row that actually carries role, facility
 * scope and org-scoped data ownership.
 *
 * Every authenticated request operates inside exactly ONE active membership.
 * The session carries `organizationUserId` + `organizationId` + `role`, all
 * three resolved from the SAME `OrganizationUser` row by the helpers here, so a
 * role claim can never be paired with a foreign organization.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { Role } from '@/types/next-auth';

export interface MembershipSummary {
  organizationUserId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
}

/**
 * How login (or an org switch) resolved a user's memberships.
 *
 * - `none`     — the identity has never joined an organization; it is a
 *                prospective founder and belongs in onboarding.
 * - `revoked`  — memberships exist but every one is deactivated; access to
 *                every organization has been removed, so login must be denied.
 * - `resolved` — exactly one candidate, or a remembered org that is still
 *                valid: sign straight in with no picker.
 * - `choice`   — two or more active memberships and no usable preference: the
 *                caller must present the org picker.
 */
export type MembershipResolution =
  | { kind: 'none' }
  | { kind: 'revoked' }
  | { kind: 'resolved'; membership: MembershipSummary }
  | { kind: 'choice'; memberships: MembershipSummary[] };

const MEMBERSHIP_SELECT = {
  id: true,
  role: true,
  organizationId: true,
  organization: { select: { name: true, slug: true } },
} as const;

function toSummary(row: {
  id: string;
  role: Role;
  organizationId: string;
  organization: { name: string; slug: string };
}): MembershipSummary {
  return {
    organizationUserId: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    organizationSlug: row.organization.slug,
    role: row.role,
  };
}

/** Every ACTIVE membership for an identity, oldest join first (stable order). */
export async function listActiveMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await prisma.organizationUser.findMany({
    where: { userId, active: true },
    select: MEMBERSHIP_SELECT,
    orderBy: { joinedAt: 'asc' },
  });
  return rows.map(toSummary);
}

/**
 * Load a single ACTIVE membership by (user, organization). Returns null when the
 * user is not a member of that org, or the membership is deactivated — the
 * authorization check behind every org switch and every JWT re-validation.
 */
export async function getActiveMembership(
  userId: string,
  organizationId: string,
): Promise<MembershipSummary | null> {
  const row = await prisma.organizationUser.findFirst({
    where: { userId, organizationId, active: true },
    select: MEMBERSHIP_SELECT,
  });
  return row ? toSummary(row) : null;
}

/**
 * Decide which membership a sign-in should activate.
 *
 * Zero-regression requirement: a user with exactly ONE active membership — the
 * shape every single-org account has today — always resolves silently, so they
 * never see a picker. A returning multi-org user skips the picker only while
 * `User.lastActiveOrganizationId` still names an active membership.
 */
export async function resolveActiveMembership(userId: string): Promise<MembershipResolution> {
  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { lastActiveOrganizationId: true },
    }),
    listActiveMemberships(userId),
  ]);

  if (memberships.length === 0) {
    // Distinguish "never joined" (a founder heading to onboarding) from "every
    // membership revoked" (access removed) — the two must not share a fate.
    const revokedCount = await prisma.organizationUser.count({ where: { userId } });
    return revokedCount > 0 ? { kind: 'revoked' } : { kind: 'none' };
  }

  if (memberships.length === 1) {
    return { kind: 'resolved', membership: memberships[0] };
  }

  const remembered = user?.lastActiveOrganizationId
    ? memberships.find((m) => m.organizationId === user.lastActiveOrganizationId)
    : undefined;

  return remembered
    ? { kind: 'resolved', membership: remembered }
    : { kind: 'choice', memberships };
}

/**
 * Pick the membership a resolution activates. On `choice` the org picker lets
 * the user switch afterwards, but the session must always be scoped to a real
 * membership, so the first (oldest-joined, deterministic) one is provisionally
 * activated rather than leaving the session org-less.
 */
export function activeMembershipOf(resolution: MembershipResolution): MembershipSummary | null {
  if (resolution.kind === 'resolved') return resolution.membership;
  if (resolution.kind === 'choice') return resolution.memberships[0];
  return null;
}

/**
 * Resolve the membership an ALREADY-ACTIVE session should render as.
 *
 * The distinction from {@link resolveActiveMembership} is deliberate: once a
 * session carries an `organizationId` on its JWT, that org is authoritative for
 * this session and must be honoured with a POINT lookup. Re-deriving via the
 * global resolver would consult `User.lastActiveOrganizationId`, which a sibling
 * session's login or a later org switch may have moved — silently bleeding a
 * multi-org user's view into a different organization than their token names.
 *
 * Only a genuinely org-less token (pre-onboarding, or just-joined and not yet
 * re-minted) falls back to the global resolver, adopting its active pick.
 */
export async function resolveMembershipForActiveSession(
  userId: string,
  sessionOrganizationId: string | null,
): Promise<MembershipSummary | null> {
  if (sessionOrganizationId) {
    return getActiveMembership(userId, sessionOrganizationId);
  }
  const resolution = await resolveActiveMembership(userId);
  return activeMembershipOf(resolution);
}

export interface CreateMembershipInput {
  userId: string;
  organizationId: string;
  /** The facility this membership is assigned to on joining. */
  facilityId: string;
  role: Role;
  jobTitle?: string | null;
}

/**
 * Attach an identity to an organization: the `OrganizationUser` row plus its
 * first `OrganizationUserFacility` assignment, created atomically so a
 * membership can never exist without facility scope.
 *
 * Re-joining is idempotent — an existing (possibly deactivated) membership is
 * reactivated and re-roled rather than duplicated, which the
 * `(userId, organizationId)` unique constraint would reject anyway.
 */
export async function createMembership(input: CreateMembershipInput): Promise<MembershipSummary> {
  const { userId, organizationId, facilityId, role, jobTitle } = input;

  return prisma.$transaction(async (tx) => {
    const membership = await tx.organizationUser.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      create: { userId, organizationId, role, jobTitle: jobTitle ?? null },
      update: {
        role,
        active: true,
        deactivatedAt: null,
        // Re-joining restarts the deadline window for role-target assignments.
        roleAssignedAt: new Date(),
        ...(jobTitle === undefined ? {} : { jobTitle }),
      },
      select: MEMBERSHIP_SELECT,
    });

    await tx.organizationUserFacility.upsert({
      where: {
        organizationUserId_facilityId: { organizationUserId: membership.id, facilityId },
      },
      create: { organizationUserId: membership.id, facilityId },
      update: { active: true, deactivatedAt: null },
    });

    return toSummary(membership);
  });
}

/**
 * Stamp the per-org login timestamp and remember the org for picker-skip.
 *
 * Fire-and-forget and fully guarded: a failure here must never break the auth
 * path, so it is logged at `warn` and swallowed rather than propagated.
 */
export function recordMembershipLogin(userId: string, membership: MembershipSummary): void {
  Promise.all([
    prisma.organizationUser.update({
      where: { id: membership.organizationUserId },
      data: { lastLoginAt: new Date() },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { lastActiveOrganizationId: membership.organizationId },
    }),
  ]).catch((err) => {
    logger.warn({
      msg: '[auth] Failed to record membership login',
      userId,
      organizationId: membership.organizationId,
      err,
    });
  });
}
