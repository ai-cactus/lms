import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createNotification } from '@/app/actions/notifications';
import { sendInstantNotificationEmail } from '@/lib/email';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import { ENGINE_EVENTS, type NotificationEngineType } from './catalog';
import { resolveRoleRecipients } from './recipients';

/**
 * The single funnel every engine notification goes through.
 *
 * One call resolves *who* should hear about an event (from the catalog's routing
 * table, with the owner-fallback escalation pathway), records it on the
 * `NotificationEvent` outbox, writes the in-app bell rows, and — for Tier 1 —
 * emails immediately. Tier 2 events are left `pending` for the digest worker.
 *
 * Never throws: a notification failing must never roll back the business action
 * that produced it (mirrors `createNotification`). Callers get a structured
 * result instead.
 */

/** Window in which a repeat emit carrying the same `dedupeKey` is suppressed. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface NotificationActor {
  userId: string;
  role: Role;
}

export interface EmitNotificationInput {
  organizationId: string;
  type: NotificationEngineType;
  /** Bell/email headline. */
  title: string;
  /** Bell/email body — one sentence describing what happened. */
  message: string;
  /** Who caused the event; null for self-serve/system events with no actor. */
  actor?: NotificationActor | null;
  /** The user the event is about (e.g. the worker who was added). */
  subjectUserId?: string | null;
  /** Facility the event belongs to — digests group by it. */
  facilityId?: string | null;
  /** Where the notification points, app-relative. */
  linkUrl?: string | null;
  /** Structured context stored alongside the rendered copy. */
  context?: Record<string, unknown>;
  /** When set, suppresses a repeat of the same key within 24h. */
  dedupeKey?: string | null;
}

export interface EmitNotificationResult {
  /** `error` means the emit itself failed; the caller's action is unaffected. */
  status: 'dispatched' | 'pending' | 'skipped' | 'throttled' | 'error';
  eventId?: string;
  recipientCount: number;
  usedFallback: boolean;
}

/**
 * Snapshot stored on `NotificationEvent.payload`. Self-contained on purpose: the
 * digest renders items straight from it, so a later rename or deletion can never
 * change what an already-recorded notification said, and `routing` pins the
 * escalation decision made at emit time (the digest re-resolves only *who* holds
 * those roles, so new hires still receive it).
 */
export interface NotificationEventPayload {
  title: string;
  message: string;
  linkUrl: string | null;
  routing: { roles: Role[]; fallbackToOwner: boolean };
  context: Record<string, unknown>;
}

const ERROR_RESULT: EmitNotificationResult = {
  status: 'error',
  recipientCount: 0,
  usedFallback: false,
};

/** True when an event carrying this dedupe key was already recorded within 24h. */
async function isThrottled(organizationId: string, dedupeKey: string, now: Date): Promise<boolean> {
  const existing = await prisma.notificationEvent.findFirst({
    where: {
      organizationId,
      dedupeKey,
      createdAt: { gte: new Date(now.getTime() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function emitNotificationEvent(
  input: EmitNotificationInput,
): Promise<EmitNotificationResult> {
  try {
    const meta = ENGINE_EVENTS[input.type];
    if (!meta) {
      logger.error({ msg: '[notifications] Unknown engine event type', type: input.type });
      return ERROR_RESULT;
    }

    const now = new Date();

    if (input.dedupeKey && (await isThrottled(input.organizationId, input.dedupeKey, now))) {
      logger.info({
        msg: '[notifications] Event suppressed — same dedupe key already recorded within 24h',
        orgId: input.organizationId,
        type: input.type,
        dedupeKey: input.dedupeKey,
      });
      return { status: 'throttled', recipientCount: 0, usedFallback: false };
    }

    const targets = meta.resolveTargets(input.actor?.role);
    const recipients = await resolveRoleRecipients(input.organizationId, targets.roles, {
      fallbackToOwner: targets.fallbackToOwner,
      excludeUserIds: [input.actor?.userId],
    });

    const payload: NotificationEventPayload = {
      title: input.title,
      message: input.message,
      linkUrl: input.linkUrl ?? null,
      routing: { roles: targets.roles, fallbackToOwner: targets.fallbackToOwner },
      context: input.context ?? {},
    };

    const hasRecipients = recipients.userIds.length > 0;
    const event = await prisma.notificationEvent.create({
      data: {
        organizationId: input.organizationId,
        facilityId: input.facilityId ?? null,
        tier: meta.tier,
        type: input.type,
        actorUserId: input.actor?.userId ?? null,
        subjectUserId: input.subjectUserId ?? null,
        payload: JSON.parse(JSON.stringify(payload)),
        status: hasRecipients ? 'pending' : 'skipped',
        dedupeKey: input.dedupeKey ?? null,
      },
      select: { id: true },
    });

    if (!hasRecipients) {
      logger.warn({
        msg: '[notifications] Event recorded with no recipients',
        orgId: input.organizationId,
        type: input.type,
        eventId: event.id,
        missingRoles: recipients.missingRoles,
      });
      await emitFallbackAlert(input, recipients.usedFallback, recipients.missingRoles);
      return {
        status: 'skipped',
        eventId: event.id,
        recipientCount: 0,
        usedFallback: recipients.usedFallback,
      };
    }

    // Both tiers write the bell row at emit time — the digest batches the email,
    // not the in-app feed.
    for (const userId of recipients.userIds) {
      await createNotification({
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        linkUrl: input.linkUrl ?? undefined,
        metadata: input.context,
      });
    }

    if (meta.tier === 'instant') {
      for (const recipient of recipients.emails) {
        await sendInstantNotificationEmail(recipient.email, recipient.name, {
          subject: input.title,
          title: meta.label,
          bodyLines: [input.message],
          actionLabel: 'View in Theraptly',
          actionLink: input.linkUrl ?? '/dashboard',
        });
      }

      await prisma.notificationEvent.update({
        where: { id: event.id },
        data: { status: 'dispatched', dispatchedAt: new Date() },
      });
    }

    logger.info({
      msg: '[notifications] Event emitted',
      orgId: input.organizationId,
      type: input.type,
      tier: meta.tier,
      eventId: event.id,
      recipientCount: recipients.userIds.length,
      usedFallback: recipients.usedFallback,
    });

    await emitFallbackAlert(input, recipients.usedFallback, recipients.missingRoles);

    return {
      status: meta.tier === 'instant' ? 'dispatched' : 'pending',
      eventId: event.id,
      recipientCount: recipients.userIds.length,
      usedFallback: recipients.usedFallback,
    };
  } catch (err) {
    logger.error({
      msg: '[notifications] Failed to emit event',
      orgId: input.organizationId,
      type: input.type,
      err,
    });
    return ERROR_RESULT;
  }
}

/**
 * The §2.2 meta-alert: tell the owner a notification had to be redirected
 * because nobody holds the role it was meant for.
 *
 * Throttled per missing role via the shared 24h dedupe window, so one unassigned
 * role produces one alert a day rather than one per event. The alert routes to
 * the owner with `fallbackToOwner: false`, so it can never recurse. The actor is
 * deliberately NOT excluded here — an owner who triggered the fallback with
 * their own action is exactly who needs to know the role is vacant.
 */
async function emitFallbackAlert(
  input: EmitNotificationInput,
  usedFallback: boolean,
  missingRoles: Role[],
): Promise<void> {
  if (!usedFallback || input.type === 'ROLE_FALLBACK_TRIGGERED') return;

  for (const role of missingRoles) {
    const roleLabel = getRoleDisplayName(role);
    await emitNotificationEvent({
      organizationId: input.organizationId,
      type: 'ROLE_FALLBACK_TRIGGERED',
      title: `No ${roleLabel} assigned`,
      message: `A notification meant for your ${roleLabel} was sent to you instead because no one currently holds that role. Assign a ${roleLabel} so these updates reach the right person.`,
      linkUrl: '/dashboard/staff',
      context: { missingRole: role, missingRoleLabel: roleLabel, triggeredByType: input.type },
      dedupeKey: `role-fallback:${role}`,
      facilityId: input.facilityId ?? null,
    });
  }
}
