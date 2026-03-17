'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { sendInviteEmail } from '@/lib/email';

// Define types for the data we expect
// Note: We are using 'any' for simplicity here to match the flexible structure,
// but in production, we would use Zod for stricter validation as planned.
// We trust the structure passed from the client which is aggregating the steps.

export interface OnboardingStep1 {
  legalName: string;
  dba?: string;
  ein?: string;
  staffCount?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  phone?: string;
  country?: string;
  streetAddress?: string;
  zipCode?: string;
  city?: string;
  state?: string;
}
export interface OnboardingStep2 {
  hipaaCompliant?: string;
  licenseNumber?: string;
}
export interface OnboardingStep3 {
  primaryBusinessType?: string;
  additionalBusinessType?: string;
  additionalBusinessTypes?: string[];
  services?: string[];
}
export interface OnboardingStep4 {
  workerEmails?: string[];
}

export interface OnboardingData {
  step1: OnboardingStep1;
  step2?: OnboardingStep2;
  step3?: OnboardingStep3;
  step4?: OnboardingStep4;
}

export async function completeOnboarding(data: OnboardingData) {
  console.log('[completeOnboarding] Starting with data:', JSON.stringify(data, null, 2));

  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }
  const userId = session.user.id;

  // Destructure data
  const { step1, step2, step3, step4 } = data;

  if (!step1) {
    return { success: false, error: 'Missing Organization Data (Step 1)' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Check for existing organization
      const existingOrg = await tx.organization.findFirst({
        where: {
          name: {
            equals: step1.legalName,
            mode: 'insensitive',
          },
        },
      });

      if (existingOrg) {
        throw new Error(
          'Organization with this name already exists. Please contact your admin for access.',
        );
      }

      // 2. Create Organization
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
          additionalBusinessTypes: step3?.additionalBusinessType
            ? [step3.additionalBusinessType]
            : step3?.additionalBusinessTypes || [],
          programServices: step3?.services || [], // Mapped from 'services' in frontend to 'programServices' in DB
        },
      });
      console.log('[completeOnboarding] Organization Created:', org.id);

      // 2. Link Admin User
      console.log('[completeOnboarding] Linking User:', userId);
      await tx.user.update({
        where: { id: userId },
        data: {
          organizationId: org.id,
          role: 'admin',
        },
      });

      // 3. Prepare Invites to be sent
      const invitesToSend: { email: string; role: string; token: string; orgName: string }[] = [];

      // Helper to queue invite
      const queueInvite = async (email: string, role: string) => {
        // Check if user exists
        const existingUser = await tx.user.findUnique({ where: { email } });
        if (existingUser) return; // Skip if user exists

        const token = crypto.randomUUID();
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
            status: 'pending',
          },
        });

        invitesToSend.push({ email, role, token, orgName: org.name });
      };

      // Process Step 4 Invites (Workers)
      if (step4?.workerEmails && Array.isArray(step4.workerEmails)) {
        for (const email of step4.workerEmails) {
          if (email) {
            await queueInvite(email, 'worker');
          }
        }
      }

      return { org, invitesToSend };
    });

    // 4. Send Emails (Outside Transaction logic, but initiated here)
    console.log(`[completeOnboarding] Sending ${result.invitesToSend.length} emails...`);

    Promise.allSettled(
      result.invitesToSend.map((invite) =>
        sendInviteEmail(
          invite.email,
          `${process.env.NEXT_PUBLIC_APP_URL}/join/${invite.token}`,
          invite.orgName,
          invite.role,
        ),
      ),
    ).catch((e) => console.error('Error sending invite emails background:', e));

    return { success: true, organizationId: result.org.id };
  } catch (error) {
    console.error('[completeOnboarding] Transaction Failed:', error);
    return { success: false, error: 'Failed to complete onboarding. Please try again.' };
  }
}
