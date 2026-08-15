'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { requireActionSession, AuthzError } from '@/lib/auth-guard';
import { audit, getClientContext } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import {
  ALWAYS_ON_NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORIES,
} from '@/lib/notifications/catalog';

const digestFrequencySchema = z.object({
  frequency: z.enum(['realtime', 'daily', 'weekly']),
});

export type DigestFrequencyInput = z.infer<typeof digestFrequencySchema>;

const categoryPreferencesSchema = z.object({
  categories: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORIES),
        emailEnabled: z.boolean(),
        inAppEnabled: z.boolean(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_CATEGORIES.length),
});

export type NotificationCategoryPreferencesInput = z.infer<typeof categoryPreferencesSchema>;

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
      return { success: false, error: 'Choose a real-time, daily, or weekly summary.' };
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

/**
 * Set the organization's per-category email / in-app delivery switches.
 *
 * Same owner-equivalent gate as the digest cadence — these switches suppress
 * delivery for the whole tenant, so a server action reaching them must not lean
 * on the page gate. The always-on security category is dropped rather than
 * rejected: the client renders it disabled, so a submission that still carries
 * it is a stale form, not an attack.
 */
export async function updateNotificationCategoryPreferences(
  input: NotificationCategoryPreferencesInput,
) {
  try {
    const session = await auth();
    requireActionSession(session, { role: 'admin' });
    // The guard throws on an unauthenticated session, so `user` is present here.
    const user = session!.user;

    if (!can(dbRoleToRoleKey(user.role), 'organization.edit')) {
      logger.warn({
        msg: '[notifications] Category preference update denied — not owner-equivalent',
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

    const parsed = categoryPreferencesSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'Invalid notification categories.' };
    }

    const writable = parsed.data.categories.filter(
      (entry) => entry.category !== ALWAYS_ON_NOTIFICATION_CATEGORY,
    );

    if (writable.length > 0) {
      await prisma.$transaction(
        writable.map((entry) =>
          prisma.notificationCategoryPreference.upsert({
            where: {
              organizationId_category: { organizationId, category: entry.category },
            },
            create: {
              organizationId,
              category: entry.category,
              emailEnabled: entry.emailEnabled,
              inAppEnabled: entry.inAppEnabled,
            },
            update: { emailEnabled: entry.emailEnabled, inAppEnabled: entry.inAppEnabled },
          }),
        ),
      );
    }

    logger.info({
      msg: '[notifications] Category preferences updated',
      orgId: organizationId,
      userId: user.id,
      categoryCount: writable.length,
    });

    await audit({
      action: 'org.notification.categories.update',
      actorId: user.id,
      actorRole: user.role,
      organizationId,
      targetType: 'organization',
      targetId: organizationId,
      ...getClientContext(await headers()),
    });

    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (error) {
    if (error instanceof AuthzError) {
      return { success: false, error: 'Unauthorized' };
    }
    logger.error({ msg: '[notifications] Failed to update category preferences', err: error });
    return { success: false, error: 'Failed to update notification settings' };
  }
}
