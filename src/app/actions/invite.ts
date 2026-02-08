'use server';

import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { sendInviteEmail } from '@/lib/email';

const prisma = new PrismaClient();

interface InviteResult {
    success: boolean;
    error?: string;
    sentCount?: number;
}

export async function createInvites(
    emails: string[],
    role: string,
    organizationId: string,
    inviterId?: string
): Promise<InviteResult> {

    if (!emails.length) return { success: false, error: 'No emails provided' };
    if (!organizationId) return { success: false, error: 'Organization ID is required' };

    let sentCount = 0;

    try {
        // Fetch organization name for the email
        const org = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { name: true }
        });

        if (!org) return { success: false, error: 'Organization not found' };

        for (const email of emails) {
            // Check if user already exists
            const existingUser = await prisma.user.findUnique({
                where: { email }
            });

            if (existingUser) {
                console.log(`User ${email} already exists, skipping invite creation.`);
                continue;
            }

            // Check if invite already pending
            const existingInvite = await prisma.invite.findFirst({
                where: { email, organizationId, status: 'pending' }
            });

            if (existingInvite) {
                console.log(`Invite already pending for ${email}`);
                continue;
            }

            const token = uuidv4();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

            // Create Invite Record
            await prisma.invite.create({
                data: {
                    email,
                    token,
                    organizationId,
                    role,
                    expiresAt,
                    invitedBy: inviterId,
                    status: 'pending'
                }
            });

            // Send Email
            const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${token}`;
            await sendInviteEmail(email, inviteLink, org.name, role);

            sentCount++;
        }

        return { success: true, sentCount };

    } catch (error) {
        console.error('Error creating invites:', error);
        return { success: false, error: 'Failed to create invites' };
    }
}
