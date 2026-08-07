'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { requireActionSession, AuthzError } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';

const digestFrequencySchema = z.object({
  frequency: z.enum(['daily', 'weekly']),
});

export type DigestFrequencyInput = z.infer<typeof digestFrequencySchema>;

/**
 * Set how often the organization's batched notification digest goes out.
 *
 * Settings is owner-only, so the action re-enforces that invariant itself rather
 * than trusting the page gate — a server action is a public endpoint.
 */
export async function updateDigestFrequency(input: DigestFrequencyInput) {
  try {
    const session = await auth();
    requireActionSession(session, { role: 'admin' });
    // The guard throws on an unauthenticated session, so `user` is present here.
    const user = session!.user;

    // Org-wide setting — restricted to the Owner-equivalent seats via the
    // registry rather than a hard-coded role literal.
    if (!can(dbRoleToRoleKey(user.role), 'organization.edit')) {
      logger.warn({
        msg: '[notifications] Digest frequency update denied — not owner-equivalent',
        userId: user.id,
        role: user.role,
      });
      return {
        success: false,
        error: 'Only an organization owner or admin can change this setting.',
      };
    }

    const organizationId = user.organizationId;
    if (!organizationId) {
      return { success: false, error: 'No organization found' };
    }

    const parsed = digestFrequencySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Choose either a daily or a weekly digest.' };
    }

    const { frequency } = parsed.data;

    await prisma.organization.update({
      where: { id: organizationId },
      data: { notificationDigestFrequency: frequency },
    });

    logger.info({
      msg: '[notifications] Digest frequency updated',
      orgId: organizationId,
      frequency,
      userId: user.id,
    });

    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (error) {
    if (error instanceof AuthzError) {
      return { success: false, error: 'Unauthorized' };
    }
    logger.error({ msg: '[notifications] Failed to update digest frequency', err: error });
    return { success: false, error: 'Failed to update notification settings' };
  }
}
