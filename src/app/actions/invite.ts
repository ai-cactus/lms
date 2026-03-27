'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { sendInviteEmail } from '@/lib/email';

const prisma = new PrismaClient();

export interface InviteResultItem {
  email: string;
  status: 'sent' | 'pending' | 'exists' | 'error' | 'resent';
  message?: string;
}

interface InviteResult {
  success: boolean; // Overall success (true if at least one processed without system error)
  results: InviteResultItem[];
  error?: string;
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
    // Fetch organization name for the email
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    if (!org) return { success: false, results: [], error: 'Organization not found' };

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

    const emailsToCreate: string[] = [];
    const newInvitesData: {
      email: string;
      token: string;
      organizationId: string;
      role: string;
      expiresAt: Date;
      invitedBy?: string;
      status: string;
    }[] = [];
    const newInvitesMap = new Map<string, (typeof newInvitesData)[0]>();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    // Pre-process emails to determine action needed
    for (const email of emails) {
      const existingUser = existingUserMap.get(email);
      if (existingUser) {
        if (existingUser.organizationId === organizationId) {
          results.push({ email, status: 'exists', message: 'User is already a member.' });
        } else {
          // User exists but in another org or no org.
          results.push({
            email,
            status: 'exists',
            message: 'User already has an account. Ask them to login.',
          });
        }
        continue;
      }

      const existingInvite = existingInviteMap.get(email);
      if (existingInvite) {
        // We will resent emails for existing pending invites later
        continue;
      }

      // Brand new invite
      const token = crypto.randomUUID();
      const inviteData = {
        email,
        token,
        organizationId,
        role,
        expiresAt,
        invitedBy: inviterId,
        status: 'pending',
      };

      emailsToCreate.push(email);
      newInvitesData.push(inviteData);
      newInvitesMap.set(email, inviteData);
    }

    // Batch insert new invites
    if (newInvitesData.length > 0) {
      await prisma.invite.createMany({
        data: newInvitesData,
      });
    }

    // Process emails concurrently using Promise.allSettled
    const emailPromises = emails.map(async (email) => {
      const existingUser = existingUserMap.get(email);
      if (existingUser) return; // Handled above

      const existingInvite = existingInviteMap.get(email);
      if (existingInvite) {
        // Resend Email
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${existingInvite.token}`;
        await sendInviteEmail(email, inviteLink, org.name, role);
        return { email, status: 'resent', message: 'Invitation resent.' };
      }

      const newInvite = newInvitesMap.get(email);
      if (newInvite) {
        // Send Email for new invite
        const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${newInvite.token}`;
        await sendInviteEmail(email, inviteLink, org.name, role);
        return { email, status: 'sent', message: 'Invitation sent.' };
      }
    });

    const emailResults = await Promise.allSettled(emailPromises);

    // Collect results from email promises
    emailResults.forEach((result, index) => {
      const email = emails[index];
      // Skip users that were already handled as existing
      if (existingUserMap.has(email)) return;

      if (result.status === 'fulfilled') {
        if (result.value) {
          results.push(result.value as InviteResultItem);
        }
      } else {
        console.error(`Error processing invite for ${email}:`, result.reason);
        results.push({ email, status: 'error', message: 'Failed to process invitation.' });
      }
    });

    revalidatePath('/dashboard/staff');
    return { success: true, results };
  } catch (error) {
    console.error('Error creating invites:', error);
    return { success: false, results: [], error: 'Failed to process requests' };
  }
}
