'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { sendInviteEmail } from '@/lib/email';

// Define types for the data we expect
// Note: We are using 'any' for simplicity here to match the flexible structure, 
// but in production, we would use Zod for stricter validation as planned.
// We trust the structure passed from the client which is aggregating the steps.

export async function completeOnboarding(data: any) {
    console.log('[completeOnboarding] Starting with data:', JSON.stringify(data, null, 2));

    const session = await auth();
    if (!session?.user?.id) {
        return { success: false, error: "Not authenticated" };
    }
    const userId = session.user.id;

    // Destructure data
    const { step1, step2, step3, step4, step5 } = data;

    if (!step1) {
        return { success: false, error: "Missing Organization Data (Step 1)" };
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Organization
            const slug = `${step1.legalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.floor(Math.random() * 10000)}`;

            console.log('[completeOnboarding] Creating Organization...');
            const org = await tx.organization.create({
                data: {
                    name: step1.legalName,
                    dba: step1.dba,
                    ein: step1.ein,
                    staffCount: step1.staffCount,
                    primaryContact: step1.primaryContactName,
                    primaryEmail: step1.primaryContactEmail,
                    phone: step1.phone,
                    country: step1.country,
                    address: step1.streetAddress,
                    zipCode: step1.zipCode,
                    city: step1.city,
                    state: step1.state,
                    slug: slug,
                    // Step 2 Data
                    isHipaaCompliant: step2?.hipaaCompliant === 'yes',
                    licenseNumber: step2?.licenseNumber,
                    // Step 3 Data
                    primaryBusinessType: step3?.primaryBusinessType,
                    additionalBusinessTypes: step3?.additionalBusinessTypes || [],
                    programServices: step3?.services || [], // Mapped from 'services' in frontend to 'programServices' in DB
                }
            });
            console.log('[completeOnboarding] Organization Created:', org.id);

            // 2. Link Admin User
            console.log('[completeOnboarding] Linking User:', userId);
            await tx.user.update({
                where: { id: userId },
                data: {
                    organizationId: org.id,
                    role: 'admin'
                }
            });

            // 3. Prepare Invites to be sent
            const invitesToSend: { email: string; role: string; token: string; orgName: string }[] = [];

            // Helper to queue invite
            const queueInvite = async (email: string, role: string) => {
                // Check if user exists
                const existingUser = await tx.user.findUnique({ where: { email } });
                if (existingUser) return; // Skip if user exists

                const token = uuidv4();
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 7);

                await tx.invite.create({
                    data: {
                        email,
                        token,
                        organizationId: org.id,
                        role,
                        expiresAt,
                        invitedBy: userId,
                        status: 'pending'
                    }
                });

                invitesToSend.push({ email, role, token, orgName: org.name });
            };

            // Process Step 4 Invites (Team)
            if (step4?.invites && Array.isArray(step4.invites)) {
                for (const invite of step4.invites) {
                    if (invite.email && invite.role) {
                        await queueInvite(invite.email, invite.role);
                    }
                }
            }

            // Process Step 5 Invites (Workers)
            if (step5?.workerEmails && Array.isArray(step5.workerEmails)) {
                for (const email of step5.workerEmails) {
                    if (email) {
                        await queueInvite(email, 'worker');
                    }
                }
            }

            return { org, invitesToSend };
        });

        // 4. Send Emails (Outside Transaction logic, but initiated here)
        // We do this non-blocking or await it? Await to confirm success.
        console.log(`[completeOnboarding] Sending ${result.invitesToSend.length} emails...`);

        // We won't block the UI for emails, but we trigger them.
        // In a real queue system we'd push a job. Here we just loop.
        Promise.allSettled(result.invitesToSend.map(invite =>
            sendInviteEmail(invite.email, `${process.env.NEXT_PUBLIC_APP_URL}/join/${invite.token}`, invite.orgName, invite.role)
        )).catch(e => console.error("Error sending invite emails background:", e));

        return { success: true, organizationId: result.org.id };

    } catch (error) {
        console.error('[completeOnboarding] Transaction Failed:', error);
        return { success: false, error: "Failed to complete onboarding. Please try again." };
    }
}
