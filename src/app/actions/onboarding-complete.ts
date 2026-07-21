'use server';

import { auth } from '@/auth';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { sendInviteEmail } from '@/lib/email';
import type { UserRole } from '@/generated/prisma/enums';
import {
  DEFAULT_SELF_SERVE_WORKER_ROLE,
  MANAGER_INVITE_ROLES,
  WORKER_ROLES,
} from '@/lib/rbac/role-utils';
import { logger } from '@/lib/logger';
import { deriveTimezoneFromState } from '@/lib/reminders/us-state-timezone';

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
export interface OnboardingDocument {
  url: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}
export interface OnboardingStep2 {
  hipaaCompliant?: string;
  licenseNumber?: string;
  documents?: OnboardingDocument[];
}
export interface OnboardingStep3 {
  primaryBusinessType?: string;
  additionalBusinessType?: string;
  additionalBusinessTypes?: string[];
  services?: string[];
}
export interface OnboardingManagerInvite {
  email: string;
  role: string;
}
export interface OnboardingStep4 {
  managerInvites?: OnboardingManagerInvite[];
}
export interface OnboardingWorkerInvite {
  email: string;
  role: string;
}
export interface OnboardingStep5 {
  workerInvites?: OnboardingWorkerInvite[];
  /** Legacy shape from a mid-onboarding client — emails without a role. */
  workerEmails?: string[];
}

export interface OnboardingData {
  step1: OnboardingStep1;
  step2?: OnboardingStep2;
  step3?: OnboardingStep3;
  step4?: OnboardingStep4;
  step5?: OnboardingStep5;
}

export type CompleteOnboardingResult =
  | { success: true; organizationId: string }
  | { success: false; error: string; code?: 'MISSING_STEP1' };

export async function completeOnboarding(data: OnboardingData): Promise<CompleteOnboardingResult> {
  // Log shape only — the payload carries raw emails (PII) and must not be logged wholesale.
  logger.info({
    msg: '[completeOnboarding] Starting',
    hasStep2: !!data.step2,
    hasStep3: !!data.step3,
    managerInviteCount: data.step4?.managerInvites?.length ?? 0,
    workerInviteCount: data.step5?.workerInvites?.length ?? data.step5?.workerEmails?.length ?? 0,
    documentCount: data.step2?.documents?.length ?? 0,
  });

  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }
  const userId = session.user.id;

  const { step1, step2, step3, step4, step5 } = data;

  if (!step1) {
    return { success: false, error: 'Missing Organization Data (Step 1)', code: 'MISSING_STEP1' };
  }

  // One organisation per user — a user already in an org cannot create another.
  const existingMembership = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });
  if (existingMembership?.organizationId) {
    return {
      success: false,
      error: 'You already belong to an organization and cannot create another.',
    };
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
      const slug = `${step1.legalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomInt(0, 10000)}`;

      logger.info({ msg: '[completeOnboarding] Creating Organization...' });
      const org = await tx.organization.create({
        data: {
          name: step1.legalName,
          dba: step1.dba,
          ein: step1.ein,
          primaryContact: step1.primaryContactName,
          primaryEmail: step1.primaryContactEmail,
          slug: slug,
          // Step 2 Data (org-level)
          isHipaaCompliant: step2?.hipaaCompliant === 'yes',
          // Step 3 Data (org-level)
          primaryBusinessType: step3?.primaryBusinessType,
          additionalBusinessTypes: step3?.additionalBusinessType
            ? [step3.additionalBusinessType]
            : step3?.additionalBusinessTypes || [],
        },
      });
      logger.info({ msg: '[completeOnboarding] Organization Created:', data: org.id });

      // 1b. Create the organisation's first facility (location/compliance fields).
      const facility = await tx.facility.create({
        data: {
          organizationId: org.id,
          name: step1.legalName,
          staffCount: step1.staffCount,
          phone: step1.phone,
          country: step1.country,
          address: step1.streetAddress,
          zipCode: step1.zipCode,
          city: step1.city,
          state: step1.state,
          timezone: deriveTimezoneFromState(step1.state),
          licenseNumber: step2?.licenseNumber,
          programServices: step3?.services || [], // Mapped from 'services' in frontend
        },
      });
      logger.info({ msg: '[completeOnboarding] Facility Created:', data: facility.id });

      // 1c. Persist any compliance documents uploaded during step 2. They were
      // parked under the founding user's onboarding storage prefix; now that the
      // facility exists, link them via FacilityDocument rows.
      if (step2?.documents?.length) {
        await tx.facilityDocument.createMany({
          data: step2.documents.map((doc) => ({
            facilityId: facility.id,
            url: doc.url,
            name: doc.name,
            sizeBytes: doc.sizeBytes,
            mimeType: doc.mimeType,
            uploadedById: userId,
          })),
        });
        logger.info({
          msg: '[completeOnboarding] Facility documents linked',
          facilityId: facility.id,
          count: step2.documents.length,
        });
      }

      // 2. Link founding user as the organisation `owner`, attached to the facility.
      logger.info({ msg: '[completeOnboarding] Linking User:', data: userId });
      await tx.user.update({
        where: { id: userId },
        data: {
          organizationId: org.id,
          facilityId: facility.id,
          role: 'owner',
          roleAssignedAt: new Date(),
        },
      });

      // 3. Prepare Invites to be sent
      const invitesToSend: { email: string; role: UserRole; token: string; orgName: string }[] = [];

      const queueInvite = async (email: string, role: UserRole) => {
        const existingUser = await tx.user.findUnique({ where: { email } });
        if (existingUser) return;

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

      // Process Step 4 Invites (Managers) — never trust the client's role.
      // Only the four manager-category roles are accepted; anything else
      // (owner, a worker role, or garbage) is skipped and logged.
      if (Array.isArray(step4?.managerInvites)) {
        for (const invite of step4.managerInvites) {
          if (!invite?.email) continue;
          if (!(MANAGER_INVITE_ROLES as readonly string[]).includes(invite.role)) {
            logger.warn({
              msg: '[completeOnboarding] Skipping manager invite with disallowed role',
              role: invite.role,
            });
            continue;
          }
          await queueInvite(invite.email, invite.role as UserRole);
        }
      }

      // Process Step 5 Invites (Workers) — never trust the client's role.
      // Only the eight worker-category roles are accepted; anything else
      // (a manager role, owner, or garbage) is skipped and logged.
      if (Array.isArray(step5?.workerInvites)) {
        for (const invite of step5.workerInvites) {
          if (!invite?.email) continue;
          if (!(WORKER_ROLES as readonly string[]).includes(invite.role)) {
            logger.warn({
              msg: '[completeOnboarding] Skipping worker invite with disallowed role',
              role: invite.role,
            });
            continue;
          }
          await queueInvite(invite.email, invite.role as UserRole);
        }
      } else if (Array.isArray(step5?.workerEmails)) {
        // Legacy shape from a mid-onboarding client — no role, use the default.
        for (const email of step5.workerEmails) {
          if (email) {
            await queueInvite(email, DEFAULT_SELF_SERVE_WORKER_ROLE);
          }
        }
      }

      return { org, invitesToSend };
    });

    // 4. Send Emails (Outside Transaction logic, but initiated here)
    logger.info({ msg: `[completeOnboarding] Sending ${result.invitesToSend.length} emails...` });

    Promise.allSettled(
      result.invitesToSend.map((invite) =>
        sendInviteEmail(
          invite.email,
          `${process.env.NEXT_PUBLIC_APP_URL}/join/${invite.token}`,
          invite.orgName,
          invite.role,
        ),
      ),
    ).catch((e) => logger.error({ msg: 'Error sending invite emails background:', err: e }));

    return { success: true, organizationId: result.org.id };
  } catch (error) {
    logger.error({ msg: '[completeOnboarding] Transaction Failed:', err: error });
    return { success: false, error: 'Failed to complete onboarding. Please try again.' };
  }
}
