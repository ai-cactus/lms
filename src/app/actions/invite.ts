'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { sendInviteEmail } from '@/lib/email';
import { logger } from '@/lib/logger';
import { BILLING_PLANS } from '@/lib/billing-plans';
import type { InviteStatus, UserRole } from '@prisma/client';

export interface InviteResultItem {
  email: string;
  status: 'sent' | 'pending' | 'exists' | 'error' | 'resent';
  message?: string;
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

export async function createInvites(
  emails: string[],
  role: string,
  organizationId: string,
  inviterId?: string,
): Promise<InviteResult> {
  if (!emails.length) return { success: false, results: [], error: 'No emails provided' };
  if (!organizationId) return { success: false, results: [], error: 'Organization ID is required' };

  const results: InviteResultItem[] = [];

  try {
    // Fetch org name and subscription plan in one round-trip
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        subscription: { select: { plan: true, status: true } },
      },
    });

    if (!org) return { success: false, results: [], error: 'Organization not found' };

    const subscription = org.subscription;
    if (subscription && subscription.status !== 'canceled') {
      const planConfig = BILLING_PLANS.find((p) => p.key === subscription.plan);

      if (planConfig && planConfig.staffMax !== null) {
        const staffMax = planConfig.staffMax;

        // Count active workers + non-expired pending invites in parallel
        const [activeWorkerCount, pendingInviteCount] = await Promise.all([
          prisma.user.count({
            where: {
              organizationId,
              role: 'worker',
            },
          }),
          prisma.invite.count({
            where: {
              organizationId,
              status: 'pending',
              expiresAt: { gt: new Date() },
            },
          }),
        ]);

        const currentTotal = activeWorkerCount + pendingInviteCount;

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
              plan: subscription.plan,
              staffMax,
              currentTotal,
              newSeatsNeeded,
              remaining,
            },
          });

          return {
            success: false,
            results: [],
            error:
              remaining === 0
                ? `Your ${planConfig.name} plan has reached its limit of ${staffMax} workers. ` +
                  `Please upgrade your plan to add more workers.`
                : `Your ${planConfig.name} plan allows up to ${staffMax} workers. ` +
                  `You have ${remaining} seat(s) remaining but are trying to add ${newSeatsNeeded}. ` +
                  `Please reduce the number of invites or upgrade your plan.`,
            limitError: {
              current: currentTotal,
              limit: staffMax,
              planName: planConfig.name,
            },
          };
        }
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
      if (existingUser) {
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

      // Brand new invite
      const token = crypto.randomUUID();
      const inviteData = {
        email,
        token,
        organizationId,
        role: role as UserRole,
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
    }

    // Send / resend emails concurrently
    const emailPromises = emails.map(async (email) => {
      if (existingUserMap.has(email)) return; // Already handled above

      const existingInvite = existingInviteMap.get(email);
      if (existingInvite) {
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${existingInvite.token}`;
        await sendInviteEmail(email, inviteLink, org.name, role);
        return { email, status: 'resent' as const, message: 'Invitation resent.' };
      }

      const newInvite = newInvitesMap.get(email);
      if (newInvite) {
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${newInvite.token}`;
        await sendInviteEmail(email, inviteLink, org.name, role);
        return { email, status: 'sent' as const, message: 'Invitation sent.' };
      }
    });

    const emailResults = await Promise.allSettled(emailPromises);

    emailResults.forEach((result, index) => {
      const email = emails[index];
      if (existingUserMap.has(email)) return; // Skip — already pushed to results

      if (result.status === 'fulfilled') {
        if (result.value) results.push(result.value as InviteResultItem);
      } else {
        logger.error({ msg: `Error processing invite for ${email}:`, err: result.reason });
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
