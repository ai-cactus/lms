'use server';

import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { sendInviteEmail } from '@/lib/email';
import { logger, maskEmail } from '@/lib/logger';
import { areFacilitiesInCallerScope } from '@/lib/facility/target-scope';
import { getSeatUsage } from '@/lib/seat-limits';
import { can } from '@/lib/rbac/permissions';
import {
  ADMIN_ROLES,
  ALL_ROLES,
  GRANTABLE_ROLES,
  dbRoleToRoleKey,
  getRoleDisplayName,
} from '@/lib/rbac/role-utils';
import type { InviteStatus, UserRole } from '@/generated/prisma/enums';
import { captureServer } from '@/lib/analytics/server';
import { toCountBand } from '@/lib/analytics/events';

export interface InviteResultItem {
  email: string;
  status: 'sent' | 'pending' | 'exists' | 'error' | 'resent' | 'forbidden';
  message?: string;
}

/** A single email + the role to grant it. */
export interface InviteItem {
  email: string;
  role: UserRole;
}

interface InviteResult {
  success: boolean;
  results: InviteResultItem[];
  error?: string;
  /** Present only when the plan seat limit is exceeded */
  limitError?: {
    current: number;
    limit: number;
    planName: string;
  };
}

export interface CreateInvitesOptions {
  /**
   * Facility to attach the invites to, overriding the inviter's own. Used when
   * inviting someone to a facility other than the caller's (e.g. the supervisor
   * invited alongside a newly created facility). Validated against the caller's
   * organization before use.
   *
   * `null` marks a GLOBAL invite — an org-wide managerial seat that is
   * deliberately not tied to the inviter's site. Omitting the field keeps the
   * legacy behaviour (inherit the inviter's facility).
   */
  facilityId?: string | null;
}

export async function createInvites(
  items: InviteItem[],
  options?: CreateInvitesOptions,
): Promise<InviteResult> {
  // SECURITY: `organizationId` and `inviterId` are intentionally NOT accepted
  // from the client — they are derived from the authenticated admin session below
  // to prevent cross-org invite injection. Each item's `role` IS client-supplied,
  // but every role is validated against the inviter's grant matrix before use.
  if (!items.length) return { success: false, results: [], error: 'No emails provided' };

  // ── Authorization: only an authenticated org admin may create invites, and the
  //    target organization + inviter are taken from the session — never the client.
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, results: [], error: 'Unauthorized' };
  }
  if (!ADMIN_ROLES.includes(session.user.role) || !session.user.organizationId) {
    return { success: false, results: [], error: 'Unauthorized' };
  }

  // Must hold the invite.create permission for their role.
  const roleKey = dbRoleToRoleKey(session.user.role);
  if (!can(roleKey, 'invite.create')) {
    return { success: false, results: [], error: 'Forbidden' };
  }

  const organizationId = session.user.organizationId;
  const inviterId = session.user.id;
  const grantableRoles = GRANTABLE_ROLES[session.user.role];

  // An explicit `null` asks for a global (org-wide) invite: the caller has
  // chosen NOT to bind these seats to a site, so the inviter's own facility must
  // not slip in as a default.
  const isGlobalInvite = options?.facilityId === null;

  // Every invite now targets a specific facility. An explicitly requested one
  // wins, but only after proving it belongs to the caller's organization — a
  // caller-supplied id must never be able to seed an invite into another tenant.
  let facilityId: string | undefined;
  if (options?.facilityId) {
    const requestedFacility = await prisma.facility.findFirst({
      where: { id: options.facilityId, organizationId },
      select: { id: true },
    });
    if (!requestedFacility) {
      logger.warn({
        msg: '[invite] Requested facility rejected — not in this organization',
        organizationId,
        facilityId: options.facilityId,
      });
      return { success: false, results: [], error: 'Invalid facility for this organization.' };
    }

    // Belonging to the org is necessary but not sufficient. A facility-bound
    // caller must also be able to REACH the destination, or a crafted id would
    // let them seed staff into a site they cannot see.
    if (!(await areFacilitiesInCallerScope(session, [requestedFacility.id]))) {
      logger.warn({
        msg: "[invite] Requested facility rejected — outside the caller's facilities",
        organizationId,
        userId: session.user.id,
        role: session.user.role,
      });
      return { success: false, results: [], error: 'Invalid facility for this organization.' };
    }

    facilityId = requestedFacility.id;
  }

  // Otherwise prefer the inviter's own facility assignment; fall back to the
  // org's oldest facility when the caller has none (e.g. an HR account not yet
  // attached to one). A global invite skips this step by design.
  if (!facilityId && !isGlobalInvite) {
    const inviterFacility = session.user.organizationUserId
      ? await prisma.organizationUserFacility.findFirst({
          where: { organizationUserId: session.user.organizationUserId, active: true },
          select: { facilityId: true },
        })
      : null;
    facilityId = inviterFacility?.facilityId;
  }

  // NOTE: `Invite.facilityId` is a required FK, so even a global invite has to
  // be anchored to a row. The org's oldest facility is the neutral anchor —
  // what actually makes these seats org-wide is the granted role
  // (see `isOrgWideFacilityRole`), not this column. Making the column nullable
  // is a schema change tracked separately.
  if (!facilityId) {
    const fallbackFacility = await prisma.facility.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    facilityId = fallbackFacility?.id;
  }

  if (!facilityId) {
    return {
      success: false,
      results: [],
      error: 'This organization has no facility configured for invites.',
    };
  }

  const results: InviteResultItem[] = [];

  // Per-row role validation: reject only the offending rows (invalid or
  // non-grantable role) rather than failing the whole batch. Surviving rows keep
  // the FIRST role seen for a given email — a defensive dedupe against a caller
  // that lists the same email twice with conflicting roles.
  const emailRoleMap = new Map<string, UserRole>();
  for (const item of items) {
    const isRealRole = ALL_ROLES.includes(item.role);
    const isGrantable = grantableRoles.includes(item.role);
    if (!isRealRole || !isGrantable) {
      logger.warn({
        msg: '[invite] Role grant denied',
        inviterRole: session.user.role,
        requestedRole: item.role,
        email: maskEmail(session.user.email),
      });
      results.push({
        email: item.email,
        status: 'forbidden',
        message: isRealRole ? 'You cannot grant the requested role.' : 'Invalid role.',
      });
      continue;
    }
    if (!emailRoleMap.has(item.email)) emailRoleMap.set(item.email, item.role);
  }

  const emails = [...emailRoleMap.keys()];

  // Every row was rejected — nothing left to process, but surface the per-row
  // outcomes so the client can show which rows failed.
  if (emails.length === 0) {
    return { success: true, results };
  }

  try {
    // Fetch org name (used for invite emails). Seat/plan resolution is handled
    // by the shared getSeatUsage helper below so the staffMax source stays
    // single-sourced with the checkout + accept paths.
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    if (!org) return { success: false, results: [], error: 'Organization not found' };

    // F-022: block issuing more invites than remaining plan seats. getSeatUsage
    // counts active workers + non-expired pending invites and resolves staffMax
    // from the shared BILLING_PLANS source; staffMax is null (nothing to
    // enforce) for unlimited plans or when there's no active subscription.
    const usage = await getSeatUsage(organizationId, { includePendingInvites: true });
    if (usage.staffMax !== null) {
      const { staffMax, current: currentTotal } = usage;
      const planName = usage.planName ?? 'current';

      // Only brand-new emails (not already members or pending-invited) consume a
      // new seat, so dedup before computing how many seats this batch needs.
      const [existingMemberEmails, existingPendingEmails] = await Promise.all([
        prisma.organizationUser.findMany({
          where: { organizationId, active: true, user: { email: { in: emails } } },
          select: { user: { select: { email: true } } },
        }),
        prisma.invite.findMany({
          where: {
            email: { in: emails },
            organizationId,
            status: 'pending',
            expiresAt: { gt: new Date() },
          },
          select: { email: true },
        }),
      ]);

      const knownEmails = new Set([
        ...existingMemberEmails.map((m) => m.user.email.toLowerCase()),
        ...existingPendingEmails.map((i) => i.email.toLowerCase()),
      ]);

      const newSeatsNeeded = emails.filter((e) => !knownEmails.has(e.toLowerCase())).length;

      if (currentTotal + newSeatsNeeded > staffMax) {
        const remaining = Math.max(0, staffMax - currentTotal);
        logger.warn({
          msg: 'Invite rejected: plan seat limit exceeded',
          data: {
            organizationId,
            plan: planName,
            staffMax,
            currentTotal,
            newSeatsNeeded,
            remaining,
          },
        });

        return {
          success: false,
          results,
          error:
            remaining === 0
              ? `Your ${planName} plan has reached its limit of ${staffMax} workers. ` +
                `Please upgrade your plan to add more workers.`
              : `Your ${planName} plan allows up to ${staffMax} workers. ` +
                `You have ${remaining} seat(s) remaining but are trying to add ${newSeatsNeeded}. ` +
                `Please reduce the number of invites or upgrade your plan.`,
          limitError: {
            current: currentTotal,
            limit: staffMax,
            planName,
          },
        };
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Batch query: which of these emails already hold an ACTIVE membership in
    // THIS organization. An identity may already exist in another organization —
    // multi-org membership is the point of this model, so that alone no longer
    // blocks an invite; only a true duplicate (already a member here) does.
    const [existingMemberships, existingInvites] = await Promise.all([
      prisma.organizationUser.findMany({
        where: { organizationId, active: true, user: { email: { in: emails } } },
        select: { user: { select: { email: true } } },
      }),
      prisma.invite.findMany({
        where: {
          email: { in: emails },
          organizationId,
          status: 'pending',
        },
      }),
    ]);

    const existingInviteMap = new Map(existingInvites.map((i) => [i.email, i]));

    // Drives the "already a member" result and the email-send skip below.
    const blockedMemberEmails = new Set(existingMemberships.map((m) => m.user.email));

    const newInvitesData: {
      email: string;
      token: string;
      organizationId: string;
      facilityId: string;
      role: UserRole;
      expiresAt: Date;
      invitedBy?: string;
      status: InviteStatus;
    }[] = [];
    const newInvitesMap = new Map<string, (typeof newInvitesData)[0]>();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

    // Pre-process emails to determine what action is needed
    for (const email of emails) {
      if (blockedMemberEmails.has(email)) {
        results.push({ email, status: 'exists', message: 'User is already a member.' });
        continue;
      }

      // Already has a pending invite — will be re-sent below
      if (existingInviteMap.has(email)) continue;

      // Brand new invite (or a re-invite for an org-less/other-org existing account)
      const token = crypto.randomUUID();
      const inviteData = {
        email,
        token,
        organizationId,
        facilityId,
        role: emailRoleMap.get(email) as UserRole,
        expiresAt,
        invitedBy: inviterId,
        status: 'pending' as InviteStatus,
      };

      newInvitesData.push(inviteData);
      newInvitesMap.set(email, inviteData);
    }

    // Batch insert new invites
    if (newInvitesData.length > 0) {
      await prisma.invite.createMany({ data: newInvitesData });
      logger.info({
        msg: '[invite] Invites created',
        organizationId,
        count: newInvitesData.length,
      });

      // Banded, not the raw count: "invited 47 staff" is close to a fingerprint
      // for a specific facility once combined with anything else.
      captureServer(
        'staff_invited',
        () => ({
          role: newInvitesData[0]?.role ?? 'unknown',
          batch_size_band: toCountBand(newInvitesData.length),
        }),
        { distinctId: inviterId, organizationId },
      );
    }

    // Send / resend emails concurrently
    const emailPromises = emails.map(async (email) => {
      if (blockedMemberEmails.has(email)) return; // Already handled above (existing member)

      const roleDisplayName = getRoleDisplayName(emailRoleMap.get(email) as UserRole);

      const existingInvite = existingInviteMap.get(email);
      if (existingInvite) {
        // Refresh the expiry so a resend never carries a nearly-expired token.
        await prisma.invite.update({
          where: { id: existingInvite.id },
          data: { expiresAt },
        });
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${existingInvite.token}`;
        await sendInviteEmail(email, inviteLink, org.name, roleDisplayName);
        return { email, status: 'resent' as const, message: 'Invitation resent.' };
      }

      const newInvite = newInvitesMap.get(email);
      if (newInvite) {
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${newInvite.token}`;
        await sendInviteEmail(email, inviteLink, org.name, roleDisplayName);
        return { email, status: 'sent' as const, message: 'Invitation sent.' };
      }
    });

    const emailResults = await Promise.allSettled(emailPromises);

    emailResults.forEach((result, index) => {
      const email = emails[index];
      if (blockedMemberEmails.has(email)) return; // Skip — already pushed to results

      if (result.status === 'fulfilled') {
        if (result.value) results.push(result.value as InviteResultItem);
      } else {
        logger.error({
          msg: '[invite] Error processing invite',
          email: maskEmail(email),
          err: result.reason,
        });
        results.push({ email, status: 'error', message: 'Failed to process invitation.' });
      }
    });

    revalidatePath('/dashboard/staff');
    return { success: true, results };
  } catch (error) {
    logger.error({ msg: 'Error creating invites:', err: error });
    return { success: false, results: [], error: 'Failed to process requests' };
  }
}
