'use server';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';
import { createNotification } from './notifications';
import { logger } from '@/lib/logger';
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/rate-limit';
import { DEFAULT_SELF_SERVE_WORKER_ROLE, getRoleDisplayName } from '@/lib/rbac/role-utils';
import { emitNotificationEvent } from '@/lib/notifications/emit';
import { enrollUserForRoleTargets } from '@/lib/enrollment/role-targets';
import { createMembership } from '@/lib/auth/membership';

// Helper to generate a cryptographically-random 6-digit code
function generateCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

export async function generateOrganizationCode() {
  const session = await adminAuth();

  if (!session?.user?.email || !session?.user?.organizationId) {
    return { success: false, error: 'Unauthorized' };
  }

  const orgId = session.user.organizationId;

  try {
    let code = generateCode();
    let isUnique = false;
    let attempts = 0;

    // Ensure uniqueness (though collision is unlikely for active codes)
    while (!isUnique && attempts < 5) {
      const existing = await prisma.organization.findUnique({
        where: { joinCode: code },
      });
      if (!existing) {
        isUnique = true;
      } else {
        code = generateCode();
        attempts++;
      }
    }

    if (!isUnique) {
      return { success: false, error: 'Failed to generate a unique code. Please try again.' };
    }

    // Set expiration to 6 hours from now
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        joinCode: code,
        joinCodeExpiresAt: expiresAt,
      },
    });

    revalidatePath('/dashboard/profile');
    return { success: true, code, expiresAt };
  } catch (error) {
    logger.error({ msg: 'Failed to generate organization code:', err: error });
    return {
      success: false,
      error: `Failed to generate code: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function getOrganizationCode() {
  const session = await adminAuth();

  if (!session?.user?.email || !session?.user?.organizationId) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      select: { joinCode: true, joinCodeExpiresAt: true },
    });

    if (!org) return { success: false, error: 'Organization not found' };

    return {
      success: true,
      code: org.joinCode,
      expiresAt: org.joinCodeExpiresAt,
    };
  } catch (error) {
    logger.error({ msg: 'Failed to fetch organization code:', err: error });
    return { success: false, error: 'Failed to fetch code' };
  }
}

export async function verifyOrganizationCode(code: string) {
  try {
    // Throttle code-guessing: 10 attempts per 15 minutes per client IP.
    // Prevents brute-forcing the 6-digit join code space.
    const hdrs = await headers();
    const ip =
      hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || hdrs.get('x-real-ip') || 'unknown';
    const { allowed } = await checkRateLimit(`org-code-verify:${ip}`, 10, 900, {
      failClosed: true,
    });
    if (!allowed) {
      return { success: false, error: 'Too many attempts. Please try again later.' };
    }

    const org = await prisma.organization.findUnique({
      where: { joinCode: code },
      select: {
        id: true,
        name: true,
        joinCodeExpiresAt: true,
        primaryBusinessType: true,
        primaryContact: true,
        // Location/services fields now live on the facility.
        facilities: {
          select: { programServices: true, country: true, phone: true },
          take: 1,
        },
      },
    });

    if (!org) {
      return { success: false, error: 'Invalid code.' };
    }

    if (org.joinCodeExpiresAt && new Date() > org.joinCodeExpiresAt) {
      return { success: false, error: 'This code has expired.' };
    }

    const facility = org.facilities[0];

    return {
      success: true,
      organization: {
        id: org.id,
        name: org.name,
        type: org.primaryBusinessType,
        services: facility?.programServices ?? [],
        country: facility?.country ?? null,
        phone: facility?.phone ?? null,
        contactName: org.primaryContact,
      },
    };
  } catch (error) {
    logger.error({ msg: 'Failed to verify code:', err: error });
    return { success: false, error: 'Failed to verify code' };
  }
}

export async function joinOrganization(code: string) {
  // Check for both session types as onboarding-worker is technically accessible to both for historical reasons
  const session = (await workerAuth()) || (await adminAuth());

  if (!session?.user?.email || !session?.user?.id) {
    return { success: false, error: 'Unauthorized' };
  }

  const userId = session.user.id;

  try {
    // Verify code again to be safe
    const verifyResult = await verifyOrganizationCode(code);
    if (!verifyResult.success || !verifyResult.organization) {
      return { success: false, error: verifyResult.error || 'Invalid code' };
    }

    const orgId = verifyResult.organization.id;

    // Attach the worker to the org's facility (one per org today).
    const facility = await prisma.facility.findFirst({
      where: { organizationId: orgId },
      select: { id: true },
    });
    if (!facility) {
      logger.warn({ msg: '[org-code] joinOrganization: no facility for organization', orgId });
      return { success: false, error: 'This organization has no facility configured.' };
    }

    const membership = await createMembership({
      userId,
      organizationId: orgId,
      facilityId: facility.id,
      role: DEFAULT_SELF_SERVE_WORKER_ROLE,
    });

    // Live auto-enroll: the worker just joined the org with a role — enroll them
    // in any active role-target assignments for it. Never throws.
    await enrollUserForRoleTargets(membership.organizationUserId, orgId);

    // Create welcome notification for worker
    await createNotification({
      organizationUserId: membership.organizationUserId,
      type: 'WELCOME',
      title: `Welcome to ${verifyResult.organization.name}`,
      message: `You have successfully joined the organization. Your training will appear here when assigned.`,
    });

    // Self-serve join: no actor, so the addition routes to HR and falls back to
    // the owner when nobody holds that role. Never throws.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, fullName: true },
    });

    const workerName = user?.fullName || user?.email?.split('@')[0] || 'A new worker';
    const roleLabel = getRoleDisplayName(DEFAULT_SELF_SERVE_WORKER_ROLE);

    await emitNotificationEvent({
      organizationId: orgId,
      type: 'STAFF_ADDED',
      title: 'New staff member added',
      message: `${workerName} joined as ${roleLabel} using an organization join code.`,
      actor: null,
      subjectUserId: userId,
      facilityId: facility.id,
      linkUrl: `/dashboard/staff/${membership.organizationUserId}`,
      context: { workerName, roleLabel, addedVia: 'join_code' },
    });

    return { success: true, organizationId: orgId };
  } catch (error) {
    logger.error({ msg: 'Failed to join organization:', err: error });
    return { success: false, error: 'Failed to join organization' };
  }
}
