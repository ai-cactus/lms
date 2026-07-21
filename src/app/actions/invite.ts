'use server';

import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { sendInviteEmail } from '@/lib/email';
import { logger, maskEmail } from '@/lib/logger';
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

export async function createInvites(items: InviteItem[]): Promise<InviteResult> {
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
        prisma.user.findMany({
          where: { email: { in: emails }, organizationId },
          select: { email: true },
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
        ...existingMemberEmails.map((u) => u.email.toLowerCase()),
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

    // Batch queries to avoid N+1 issue
    const [existingUsers, existingInvites] = await Promise.all([
      prisma.user.findMany({
        where: { email: { in: emails } },
        include: { organization: true },
      }),
      prisma.invite.findMany({
        where: {
          email: { in: emails },
          organizationId,
          status: 'pending',
        },
      }),
    ]);

    const existingUserMap = new Map(existingUsers.map((u) => [u.email, u]));
    const existingInviteMap = new Map(existingInvites.map((i) => [i.email, i]));

    // Accounts already tied to an organization cannot be (re-)invited: same-org is
    // already a member, a different org must not be poached. Org-less accounts
    // (e.g. a removed user) are NOT blocked — they are re-invited like a fresh
    // address and relinked on accept. This set drives the email-send skip below.
    const blockedUserEmails = new Set(
      existingUsers.filter((u) => u.organizationId !== null).map((u) => u.email),
    );

    const newInvitesData: {
      email: string;
      token: string;
      organizationId: string;
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
      const existingUser = existingUserMap.get(email);
      // Only accounts already bound to an org short-circuit; an org-less existing
      // account falls through to be re-invited (and relinked on accept).
      if (existingUser && existingUser.organizationId !== null) {
        if (existingUser.organizationId === organizationId) {
          results.push({ email, status: 'exists', message: 'User is already a member.' });
        } else {
          results.push({
            email,
            status: 'exists',
            message: 'User already has an account. Ask them to login.',
          });
        }
        continue;
      }

      // Already has a pending invite — will be re-sent below
      if (existingInviteMap.has(email)) continue;

      // Brand new invite (or a re-invite for an org-less existing account)
      const token = crypto.randomUUID();
      const inviteData = {
        email,
        token,
        organizationId,
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
    }

    // Send / resend emails concurrently
    const emailPromises = emails.map(async (email) => {
      if (blockedUserEmails.has(email)) return; // Already handled above (member/other-org)

      const roleDisplayName = getRoleDisplayName(emailRoleMap.get(email) as UserRole);

      const existingInvite = existingInviteMap.get(email);
      if (existingInvite) {
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
      if (blockedUserEmails.has(email)) return; // Skip — already pushed to results

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
