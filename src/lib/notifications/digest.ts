import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';
import { Prisma } from '@/generated/prisma/client';
import type { DigestFrequency } from '@/generated/prisma/enums';
import type { Role } from '@/types/next-auth';
import { ENGINE_EVENTS, type NotificationEngineType } from './catalog';
import { isNotificationChannelEnabled } from './category-preferences';
import { resolveRoleRecipients } from './recipients';

/**
 * Notification digest — pure, unit-testable orchestration (mirrors
 * `runReminderSweep`).
 *
 * One pass per cron tick: every organization holding `pending` notification
 * events whose cadence is due this run gets exactly one digest per period. The
 * `NotificationDigestRun` row is claimed BEFORE any sending, so a concurrent run
 * (or a retried job) loses the race on the unique constraint and sends nothing.
 *
 * Recipients are resolved at *send* time, not emit time: someone hired into the
 * HR seat yesterday receives today's digest of events that were routed to "HR"
 * before they existed. Each recipient's own actions are filtered out of their
 * copy.
 *
 * Declared tradeoff: a digest email that fails to send is not re-digested — the
 * events are still marked `dispatched` (with their `digestRunId`), which keeps
 * the run idempotent and leaves a future retry pass able to find them.
 */

/** Facility bucket for events that carry no facility. */
export const ORGANIZATION_WIDE_LABEL = 'Organization-wide';

export interface DigestItem {
  title: string;
  message: string;
  occurredAt: Date;
}

export interface DigestGroup {
  type: string;
  label: string;
  items: DigestItem[];
}

export interface DigestSection {
  facilityName: string;
  groups: DigestGroup[];
}

/** Abstract digest email, mapped onto a template by `email-sender.ts`. */
export interface NotificationDigestMessage {
  to: string;
  toName: string | null;
  organizationName: string;
  frequency: DigestFrequency;
  periodKey: string;
  totalCount: number;
  sections: DigestSection[];
}

export interface DigestDeliveryResult {
  ok: boolean;
  error?: unknown;
}

export type NotificationDigestSender = (
  message: NotificationDigestMessage,
) => Promise<DigestDeliveryResult>;

/** Default transport — the digest logic is inert until a sender is injected. */
export const noopDigestSender: NotificationDigestSender = async () => ({ ok: true });

export interface NotificationDigestOptions {
  now: Date;
  /** When true, log intended sends and perform zero writes. */
  dryRun: boolean;
  /** Email transport injected by the worker (the real template-backed sender). */
  sendEmail?: NotificationDigestSender;
}

export interface DigestRunSummary {
  /** Organizations holding at least one pending event. */
  organizationsScanned: number;
  /** …of which are due to receive a digest on this run. */
  organizationsDue: number;
  /** Digest runs that completed and marked their events dispatched. */
  digestsSent: number;
  emailsSent: number;
  eventsDispatched: number;
  /** Organizations skipped — already digested this period. */
  skipped: number;
  /** Emails a dry run would have sent. Always 0 outside dry-run. */
  wouldSend: number;
  errors: number;
}

interface PendingEvent {
  id: string;
  facilityId: string | null;
  type: string;
  actorUserId: string | null;
  payload: unknown;
  createdAt: Date;
}

interface EventRouting {
  roles: Role[];
  fallbackToOwner: boolean;
}

interface EventDisplay {
  title: string;
  message: string;
}

/** Zero-padded ISO-8601 week (`GGGG-Www`) of a date, in UTC. */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks are numbered by the Thursday they contain.
  const isoDayOfWeek = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - isoDayOfWeek);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Stable identity of one digest period, in UTC — `daily:2026-08-03` or
 * `weekly:2026-W32`. Paired with the organization id it forms the claim key that
 * makes a digest at-most-once per period.
 */
export function periodKeyFor(frequency: DigestFrequency, now: Date): string {
  if (frequency === 'weekly') return `weekly:${isoWeekKey(now)}`;
  return `daily:${now.toISOString().slice(0, 10)}`;
}

/** Daily digests go out every run; weekly digests only on Mondays (UTC). */
function isDue(frequency: DigestFrequency, now: Date): boolean {
  return frequency === 'weekly' ? now.getUTCDay() === 1 : true;
}

/** Read the routing pinned at emit time, defaulting to the catalog's actorless route. */
function readRouting(event: PendingEvent): EventRouting {
  const payload = event.payload as { routing?: { roles?: unknown; fallbackToOwner?: unknown } };
  const roles = payload?.routing?.roles;
  if (Array.isArray(roles) && roles.length > 0) {
    return {
      roles: roles as Role[],
      fallbackToOwner: payload?.routing?.fallbackToOwner === true,
    };
  }
  const meta = ENGINE_EVENTS[event.type as NotificationEngineType];
  return meta ? meta.resolveTargets(null) : { roles: [], fallbackToOwner: false };
}

/** Read the copy snapshotted at emit time. */
function readDisplay(event: PendingEvent): EventDisplay {
  const payload = event.payload as { title?: unknown; message?: unknown };
  return {
    title: typeof payload?.title === 'string' ? payload.title : eventLabel(event.type),
    message: typeof payload?.message === 'string' ? payload.message : '',
  };
}

function eventLabel(type: string): string {
  return ENGINE_EVENTS[type as NotificationEngineType]?.label ?? type;
}

/** Group one recipient's events into facility → type → chronological sections. */
function buildSections(
  events: PendingEvent[],
  facilityNames: Map<string, string>,
): DigestSection[] {
  const byFacility = new Map<string, PendingEvent[]>();
  for (const event of events) {
    const facilityName = event.facilityId
      ? (facilityNames.get(event.facilityId) ?? ORGANIZATION_WIDE_LABEL)
      : ORGANIZATION_WIDE_LABEL;
    const bucket = byFacility.get(facilityName);
    if (bucket) bucket.push(event);
    else byFacility.set(facilityName, [event]);
  }

  return [...byFacility.entries()].map(([facilityName, facilityEvents]) => {
    const byType = new Map<string, PendingEvent[]>();
    for (const event of facilityEvents) {
      const bucket = byType.get(event.type);
      if (bucket) bucket.push(event);
      else byType.set(event.type, [event]);
    }

    const groups: DigestGroup[] = [...byType.entries()].map(([type, typeEvents]) => ({
      type,
      label: eventLabel(type),
      items: typeEvents
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((event) => {
          const display = readDisplay(event);
          return { title: display.title, message: display.message, occurredAt: event.createdAt };
        }),
    }));

    return { facilityName, groups };
  });
}

/**
 * Drop the events whose category the organization has switched off for email.
 * They still get marked dispatched by the caller — the in-app row was already
 * written at emit time, so re-digesting them later would only duplicate it.
 */
async function emailableEvents(
  organizationId: string,
  events: PendingEvent[],
): Promise<PendingEvent[]> {
  const decisionByType = new Map<string, boolean>();
  const kept: PendingEvent[] = [];

  for (const event of events) {
    let enabled = decisionByType.get(event.type);
    if (enabled === undefined) {
      enabled = await isNotificationChannelEnabled(organizationId, event.type, 'email');
      decisionByType.set(event.type, enabled);
    }
    if (enabled) kept.push(event);
  }

  return kept;
}

export async function runNotificationDigest(
  opts: NotificationDigestOptions,
): Promise<DigestRunSummary> {
  const { now, dryRun } = opts;

  const summary: DigestRunSummary = {
    organizationsScanned: 0,
    organizationsDue: 0,
    digestsSent: 0,
    emailsSent: 0,
    eventsDispatched: 0,
    skipped: 0,
    wouldSend: 0,
    errors: 0,
  };

  logger.info({ msg: '[notifications] Starting digest run', dryRun });

  const pendingOrgs = await prisma.notificationEvent.groupBy({
    by: ['organizationId'],
    where: { status: 'pending', createdAt: { lte: now } },
  });
  summary.organizationsScanned = pendingOrgs.length;
  if (pendingOrgs.length === 0) {
    logger.info({ msg: '[notifications] Digest run complete — nothing pending', dryRun });
    return summary;
  }

  const organizations = await prisma.organization.findMany({
    where: { id: { in: pendingOrgs.map((o) => o.organizationId) } },
    select: { id: true, name: true, notificationDigestFrequency: true },
  });

  for (const organization of organizations) {
    const frequency = organization.notificationDigestFrequency;
    if (!isDue(frequency, now)) continue;
    summary.organizationsDue += 1;

    try {
      await digestOrganization(organization, frequency, opts, summary);
    } catch (err) {
      summary.errors += 1;
      logger.error({
        msg: '[notifications] Digest failed for organization — events left pending',
        orgId: organization.id,
        err,
      });
    }
  }

  logger.info({ msg: '[notifications] Digest run complete', dryRun, ...summary });
  return summary;
}

async function digestOrganization(
  organization: { id: string; name: string },
  frequency: DigestFrequency,
  opts: NotificationDigestOptions,
  summary: DigestRunSummary,
): Promise<void> {
  const { now, dryRun } = opts;
  const sendEmail = opts.sendEmail ?? noopDigestSender;
  const periodKey = periodKeyFor(frequency, now);

  let runId: string | null = null;
  if (!dryRun) {
    // Claim first: a concurrent run loses the race on @@unique and sends nothing.
    try {
      const run = await prisma.notificationDigestRun.create({
        data: { organizationId: organization.id, periodKey },
        select: { id: true },
      });
      runId = run.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        summary.skipped += 1;
        logger.info({
          msg: '[notifications] Digest already claimed for this period — skipping',
          orgId: organization.id,
          periodKey,
        });
        return;
      }
      throw err;
    }
  }

  try {
    const events = (await prisma.notificationEvent.findMany({
      where: { organizationId: organization.id, status: 'pending', createdAt: { lte: now } },
      select: {
        id: true,
        facilityId: true,
        type: true,
        actorUserId: true,
        payload: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as PendingEvent[];

    if (events.length === 0) {
      if (runId) {
        await prisma.notificationDigestRun.update({
          where: { id: runId },
          data: { status: 'sent', eventCount: 0, sentAt: now },
        });
      }
      return;
    }

    const mailable = await emailableEvents(organization.id, events);

    const facilityIds = [...new Set(mailable.map((e) => e.facilityId).filter((id) => id !== null))];
    const facilities = facilityIds.length
      ? await prisma.facility.findMany({
          where: { id: { in: facilityIds } },
          select: { id: true, name: true },
        })
      : [];
    const facilityNames = new Map(facilities.map((f) => [f.id, f.name]));

    // One resolution per distinct route, reused across every event that shares it.
    const routeCache = new Map<string, { userId: string; email: string; name: string | null }[]>();
    const perRecipient = new Map<
      string,
      { email: string; name: string | null; events: PendingEvent[] }
    >();

    for (const event of mailable) {
      const routing = readRouting(event);
      if (routing.roles.length === 0) continue;

      const routeKey = `${routing.roles.join(',')}|${routing.fallbackToOwner}`;
      let resolved = routeCache.get(routeKey);
      if (!resolved) {
        const recipients = await resolveRoleRecipients(organization.id, routing.roles, {
          fallbackToOwner: routing.fallbackToOwner,
        });
        resolved = recipients.emails;
        routeCache.set(routeKey, resolved);
      }

      for (const recipient of resolved) {
        // Nobody needs a summary of their own actions.
        if (event.actorUserId === recipient.userId) continue;
        const bucket = perRecipient.get(recipient.userId);
        if (bucket) bucket.events.push(event);
        else
          perRecipient.set(recipient.userId, {
            email: recipient.email,
            name: recipient.name,
            events: [event],
          });
      }
    }

    if (dryRun) {
      summary.wouldSend += perRecipient.size;
      logger.info({
        msg: '[notifications] Dry run — digest not sent',
        orgId: organization.id,
        periodKey,
        eventCount: events.length,
        recipientCount: perRecipient.size,
      });
      return;
    }

    for (const [userId, bucket] of perRecipient) {
      const result = await sendEmail({
        to: bucket.email,
        toName: bucket.name,
        organizationName: organization.name,
        frequency,
        periodKey,
        totalCount: bucket.events.length,
        sections: buildSections(bucket.events, facilityNames),
      });

      if (result.ok) {
        summary.emailsSent += 1;
      } else {
        summary.errors += 1;
        logger.error({
          msg: '[notifications] Digest email failed — not re-digested',
          orgId: organization.id,
          userId,
          to: maskEmail(bucket.email),
          err: result.error,
        });
      }
    }

    await prisma.notificationEvent.updateMany({
      where: { id: { in: events.map((e) => e.id) } },
      data: { status: 'dispatched', dispatchedAt: now, digestRunId: runId },
    });

    if (runId) {
      await prisma.notificationDigestRun.update({
        where: { id: runId },
        data: { status: 'sent', eventCount: events.length, sentAt: now },
      });
    }

    summary.digestsSent += 1;
    summary.eventsDispatched += events.length;
  } catch (err) {
    if (runId) {
      // Leave the events pending so the next period can pick them up once the
      // underlying failure is resolved.
      await prisma.notificationDigestRun
        .update({ where: { id: runId }, data: { status: 'failed' } })
        .catch((updateErr) => {
          logger.error({
            msg: '[notifications] Failed to mark digest run failed',
            orgId: organization.id,
            err: updateErr,
          });
        });
    }
    throw err;
  }
}
