import prisma from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import type { ReminderNudgeKind, ReminderStage } from '@/generated/prisma/enums';
import { logger, maskEmail } from '@/lib/logger';
import { REMINDER_STAGE_DEFAULTS } from '@/lib/reminders/stages';
import { resolveEscalationRecipients } from '@/lib/reminders/recipients';
import { DEFAULT_TZ, diffInDaysInTz } from '@/lib/reminders/time';
import { resolveRoleRecipients } from '@/lib/notifications/recipients';
import {
  buildSections,
  emailableEvents,
  isDue,
  readRouting,
  type PendingEvent,
} from '@/lib/notifications/digest';
import {
  buildCycleSummarySections,
  countSectionItems,
  type CycleSummarySection,
  type ReminderSummaryItem,
} from './sections';

/**
 * Cycle summary — pure, unit-testable orchestration (mirrors `digest.ts`).
 *
 * One pass per day: every organization holding un-summarized reminder rows OR
 * pending notification events is claimed for the day and each of its recipients
 * receives exactly ONE email covering everything that concerns them. Reminder
 * content is always included; the notification section is included only when the
 * organization's `notificationDigestFrequency` is due this run — so weekly
 * organizations get it on Mondays. A `realtime` organization counts as due
 * (`isDue` says so) but normally has nothing pending, because its digest-tier
 * events are dispatched at emit time; treating it as due is what drains the
 * events a daily → realtime switch would otherwise strand forever.
 *
 * The `CycleSummaryRun` row is claimed BEFORE any sending, so a concurrent run
 * (or a retried job) loses the race on the unique constraint and sends nothing.
 *
 * Recipients are resolved at *compose* time rather than at claim/dispatch time —
 * a deliberate change from the reminder ladder, which resolved escalation
 * targets when the stage fired. The consequence is intended: a manager appointed
 * after a reminder fired still sees it in that day's summary, and one who left
 * does not. It also makes the per-recipient grouping possible at all, since the
 * ladder never recorded *who* a given ReminderLog was mailed to.
 *
 * Declared tradeoff: a summary email that fails to send is not re-summarized —
 * its source rows are still stamped (`summarizedAt` / `dispatched`), which keeps
 * the run idempotent. The failed EmailMessage row carries the error.
 *
 * NOT WIRED IN PR 1. Nothing imports this module from a production code path;
 * PR 2 adds the queue/worker behind `CYCLE_SUMMARY_ENABLED`.
 */

/** `EmailMessage.kind` for a unified summary send. */
export const CYCLE_SUMMARY_EMAIL_KIND = 'cycle_summary';

/** Abstract summary email, mapped onto a template by `email-sender.ts`. */
export interface CycleSummaryMessage {
  to: string;
  toName: string | null;
  organizationName: string;
  /** Always `daily:YYYY-MM-DD`. */
  periodKey: string;
  sections: CycleSummarySection[];
  /** Total source rows the email covers — used for logging only. */
  itemCount: number;
}

export interface CycleSummaryDeliveryResult {
  ok: boolean;
  error?: unknown;
}

export type CycleSummarySender = (
  message: CycleSummaryMessage,
) => Promise<CycleSummaryDeliveryResult>;

/** Default transport — the compose logic is inert until a sender is injected. */
export const noopCycleSummarySender: CycleSummarySender = async () => ({ ok: true });

export interface CycleSummaryOptions {
  now: Date;
  /** When true, log intended sends and perform zero writes. */
  dryRun: boolean;
  /** Email transport injected by the worker (the real template-backed sender). */
  sendEmail?: CycleSummarySender;
}

export interface CycleSummaryRunSummary {
  /** Organizations with un-summarized reminders and/or pending events. */
  organizationsScanned: number;
  /** Summary runs that completed and stamped their source rows. */
  summariesSent: number;
  emailsSent: number;
  /** Reminder rows stamped `summarizedAt` by this run. */
  remindersSummarized: number;
  /** Notification events flipped to `dispatched` by this run. */
  eventsDispatched: number;
  /** Organizations skipped — already summarized this period. */
  skipped: number;
  /** Emails a dry run would have sent. Always 0 outside dry-run. */
  wouldSend: number;
  errors: number;
}

/**
 * Stable identity of one summary period, in UTC — `daily:2026-09-23`. The
 * summary is daily for every organization, so unlike the digest's period key
 * this takes no frequency.
 */
export function periodKeyForDay(now: Date): string {
  return `daily:${now.toISOString().slice(0, 10)}`;
}

/** A reminder row gathered for summarizing, with everything the copy needs. */
interface ReminderSourceRow {
  id: string;
  itemType: 'reminder_log' | 'reminder_nudge';
  stage?: ReminderStage;
  kind?: ReminderNudgeKind;
  organizationId: string;
  /** The learner's membership — section 1/2 recipient and escalation anchor. */
  organizationUserId: string;
  workerEmail: string;
  /** Real display name, or null — used as the email's `toName`. */
  workerFullName: string | null;
  /** Display name for copy, falling back to the address when none is set. */
  workerName: string;
  courseTitle: string;
  dueAt: Date | null;
  timezone: string;
}

/** One recipient's slice of an organization's summary. */
interface RecipientBucket {
  organizationUserId: string;
  email: string;
  name: string | null;
  reminders: ReminderSummaryItem[];
  events: PendingEvent[];
}

const ENROLLMENT_CONTEXT_SELECT = {
  dueAt: true,
  organizationUserId: true,
  course: { select: { title: true } },
  organizationUser: {
    select: {
      organizationId: true,
      user: { select: { email: true, fullName: true } },
      facilities: {
        where: { active: true },
        take: 1,
        select: { facility: { select: { timezone: true } } },
      },
    },
  },
} as const;

type EnrollmentContext = {
  dueAt: Date | null;
  organizationUserId: string;
  course: { title: string };
  organizationUser: {
    organizationId: string;
    user: { email: string; fullName: string | null };
    facilities: { facility: { timezone: string | null } }[];
  };
};

function toSourceRow(
  id: string,
  itemType: 'reminder_log' | 'reminder_nudge',
  enrollment: EnrollmentContext,
  stageOrKind: { stage?: ReminderStage; kind?: ReminderNudgeKind },
): ReminderSourceRow {
  const membership = enrollment.organizationUser;
  return {
    id,
    itemType,
    ...stageOrKind,
    organizationId: membership.organizationId,
    organizationUserId: enrollment.organizationUserId,
    workerEmail: membership.user.email,
    workerFullName: membership.user.fullName,
    workerName: membership.user.fullName ?? membership.user.email,
    courseTitle: enrollment.course.title,
    dueAt: enrollment.dueAt,
    timezone: membership.facilities[0]?.facility.timezone ?? DEFAULT_TZ,
  };
}

/**
 * Every reminder row still awaiting a summary, across all organizations.
 *
 * Deliberately one global read rather than a per-organization query: the daily
 * cadence bounds the result to roughly one day of reminder activity, and the
 * partial `WHERE summarized_at IS NULL` indexes make it a small scan, so this
 * trades a little memory for avoiding an N+1 across the tenant list.
 *
 * Ladder rows are filtered to the ones that asked for email; nudges have no
 * channel column and are always emailed.
 */
async function gatherReminderRows(): Promise<ReminderSourceRow[]> {
  const [logs, nudges] = await Promise.all([
    prisma.reminderLog.findMany({
      where: { summarizedAt: null, channels: { has: 'email' } },
      select: { id: true, stage: true, enrollment: { select: ENROLLMENT_CONTEXT_SELECT } },
    }),
    prisma.reminderNudge.findMany({
      where: { summarizedAt: null },
      select: { id: true, kind: true, enrollment: { select: ENROLLMENT_CONTEXT_SELECT } },
    }),
  ]);

  return [
    ...logs.map((log) => toSourceRow(log.id, 'reminder_log', log.enrollment, { stage: log.stage })),
    ...nudges.map((nudge) =>
      toSourceRow(nudge.id, 'reminder_nudge', nudge.enrollment, { kind: nudge.kind }),
    ),
  ];
}

/** Whole days past the deadline at compose time, in the learner's facility zone. */
function daysOverdueFor(row: ReminderSourceRow, now: Date): number {
  if (!row.dueAt) return 0;
  return Math.max(0, diffInDaysInTz(now, row.dueAt, row.timezone));
}

function toSummaryItem(
  row: ReminderSourceRow,
  recipientRole: 'worker' | 'escalation',
  now: Date,
): ReminderSummaryItem {
  return {
    id: row.id,
    itemType: row.itemType,
    stage: row.stage,
    kind: row.kind,
    recipientRole,
    courseTitle: row.courseTitle,
    dueAt: row.dueAt,
    workerName: row.workerName,
    daysOverdue: daysOverdueFor(row, now),
  };
}

/** Which audiences a gathered row concerns. Nudges are single-audience by kind. */
function audienceOf(row: ReminderSourceRow): { worker: boolean; escalation: boolean } {
  if (row.itemType === 'reminder_nudge') {
    return { worker: row.kind === 'WORKER_RETAKE', escalation: row.kind === 'ADMIN_REASSIGN' };
  }
  if (!row.stage) return { worker: false, escalation: false };
  const audience = REMINDER_STAGE_DEFAULTS[row.stage].audience;
  return {
    worker: audience === 'worker' || audience === 'worker_and_escalation',
    escalation: audience === 'escalation' || audience === 'worker_and_escalation',
  };
}

export async function runCycleSummary(opts: CycleSummaryOptions): Promise<CycleSummaryRunSummary> {
  const { now, dryRun } = opts;

  const summary: CycleSummaryRunSummary = {
    organizationsScanned: 0,
    summariesSent: 0,
    emailsSent: 0,
    remindersSummarized: 0,
    eventsDispatched: 0,
    skipped: 0,
    wouldSend: 0,
    errors: 0,
  };

  logger.info({ msg: '[cycle-summary] Starting run', dryRun });

  // The scan is a UNION: an organization with reminders but no pending
  // notification events must still be summarized, and vice versa. Scanning only
  // the notification side (the digest's query) would silently drop every
  // reminder-only tenant.
  const [pendingOrgs, reminderRows] = await Promise.all([
    prisma.notificationEvent.groupBy({
      by: ['organizationId'],
      where: { status: 'pending', createdAt: { lte: now } },
    }),
    gatherReminderRows(),
  ]);

  const remindersByOrg = new Map<string, ReminderSourceRow[]>();
  for (const row of reminderRows) {
    const bucket = remindersByOrg.get(row.organizationId);
    if (bucket) bucket.push(row);
    else remindersByOrg.set(row.organizationId, [row]);
  }

  const organizationIds = [
    ...new Set([...pendingOrgs.map((o) => o.organizationId), ...remindersByOrg.keys()]),
  ];
  summary.organizationsScanned = organizationIds.length;

  if (organizationIds.length === 0) {
    logger.info({ msg: '[cycle-summary] Run complete — nothing to summarize', dryRun });
    return summary;
  }

  const organizations = await prisma.organization.findMany({
    where: { id: { in: organizationIds } },
    select: { id: true, name: true, notificationDigestFrequency: true },
  });

  for (const organization of organizations) {
    try {
      await composeOrganization(
        organization,
        remindersByOrg.get(organization.id) ?? [],
        opts,
        summary,
      );
    } catch (err) {
      summary.errors += 1;
      logger.error({
        msg: '[cycle-summary] Failed for organization — source rows left un-summarized',
        orgId: organization.id,
        err,
      });
    }
  }

  logger.info({ msg: '[cycle-summary] Run complete', dryRun, ...summary });
  return summary;
}

async function composeOrganization(
  organization: {
    id: string;
    name: string;
    notificationDigestFrequency: Parameters<typeof isDue>[0];
  },
  reminderRows: ReminderSourceRow[],
  opts: CycleSummaryOptions,
  summary: CycleSummaryRunSummary,
): Promise<void> {
  const { now, dryRun } = opts;
  const sendEmail = opts.sendEmail ?? noopCycleSummarySender;
  const periodKey = periodKeyForDay(now);

  let runId: string | null = null;
  if (!dryRun) {
    // Claim first: a concurrent run loses the race on @@unique and sends nothing.
    try {
      const run = await prisma.cycleSummaryRun.create({
        data: { organizationId: organization.id, periodKey },
        select: { id: true },
      });
      runId = run.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        summary.skipped += 1;
        logger.info({
          msg: '[cycle-summary] Already claimed for this period — skipping',
          orgId: organization.id,
          periodKey,
        });
        return;
      }
      throw err;
    }
  }

  try {
    // Reminder content always ships; the notification section is cadence-gated.
    const events = isDue(organization.notificationDigestFrequency, now)
      ? ((await prisma.notificationEvent.findMany({
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
        })) as PendingEvent[])
      : [];

    if (reminderRows.length === 0 && events.length === 0) {
      if (runId) {
        await prisma.cycleSummaryRun.update({
          where: { id: runId },
          data: { status: 'sent', eventCount: 0, sentAt: now },
        });
      }
      return;
    }

    const mailable = events.length > 0 ? await emailableEvents(organization.id, events) : [];

    const facilityIds = [...new Set(mailable.map((e) => e.facilityId).filter((id) => id !== null))];
    const facilities = facilityIds.length
      ? await prisma.facility.findMany({
          where: { id: { in: facilityIds } },
          select: { id: true, name: true },
        })
      : [];
    const facilityNames = new Map(facilities.map((f) => [f.id, f.name]));

    const buckets = new Map<string, RecipientBucket>();
    const addTo = (
      recipient: { organizationUserId: string; email: string; name: string | null },
      apply: (bucket: RecipientBucket) => void,
    ): void => {
      let bucket = buckets.get(recipient.organizationUserId);
      if (!bucket) {
        bucket = {
          organizationUserId: recipient.organizationUserId,
          email: recipient.email,
          name: recipient.name,
          reminders: [],
          events: [],
        };
        buckets.set(recipient.organizationUserId, bucket);
      }
      apply(bucket);
    };

    // One escalation resolution per learner, reused across all of their rows.
    const escalationCache = new Map<
      string,
      { organizationUserId: string; email: string; name: string | null }[]
    >();

    for (const row of reminderRows) {
      const audience = audienceOf(row);

      if (audience.worker) {
        addTo(
          {
            organizationUserId: row.organizationUserId,
            email: row.workerEmail,
            name: row.workerFullName,
          },
          (bucket) => bucket.reminders.push(toSummaryItem(row, 'worker', now)),
        );
      }

      if (audience.escalation) {
        let escalation = escalationCache.get(row.organizationUserId);
        if (!escalation) {
          const resolved = await resolveEscalationRecipients({
            organizationUserId: row.organizationUserId,
          });
          escalation = resolved.members;
          escalationCache.set(row.organizationUserId, escalation);
        }
        for (const recipient of escalation) {
          addTo(recipient, (bucket) =>
            bucket.reminders.push(toSummaryItem(row, 'escalation', now)),
          );
        }
      }
    }

    // One resolution per distinct route, reused across every event that shares it.
    const routeCache = new Map<
      string,
      { organizationUserId: string; userId: string; email: string; name: string | null }[]
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
        addTo(recipient, (bucket) => bucket.events.push(event));
      }
    }

    if (dryRun) {
      summary.wouldSend += buckets.size;
      logger.info({
        msg: '[cycle-summary] Dry run — summary not sent',
        orgId: organization.id,
        periodKey,
        reminderCount: reminderRows.length,
        eventCount: events.length,
        recipientCount: buckets.size,
      });
      return;
    }

    for (const bucket of buckets.values()) {
      await deliverBucket({
        bucket,
        organization,
        facilityNames,
        periodKey,
        runId,
        now,
        sendEmail,
        summary,
      });
    }

    // Anything that resolved to no recipient at all must still be stamped, or
    // it would be re-gathered on every future run forever. Rows already stamped
    // inside a recipient transaction are excluded by the `IS NULL` / `pending`
    // guards, so this only mops up the leftovers.
    const reminderLogIds = reminderRows
      .filter((r) => r.itemType === 'reminder_log')
      .map((r) => r.id);
    const reminderNudgeIds = reminderRows
      .filter((r) => r.itemType === 'reminder_nudge')
      .map((r) => r.id);

    if (reminderLogIds.length > 0) {
      await prisma.reminderLog.updateMany({
        where: { id: { in: reminderLogIds }, summarizedAt: null },
        data: { summarizedAt: now },
      });
    }
    if (reminderNudgeIds.length > 0) {
      await prisma.reminderNudge.updateMany({
        where: { id: { in: reminderNudgeIds }, summarizedAt: null },
        data: { summarizedAt: now },
      });
    }
    if (events.length > 0) {
      await prisma.notificationEvent.updateMany({
        where: { id: { in: events.map((e) => e.id) }, status: 'pending' },
        data: { status: 'dispatched', dispatchedAt: now, digestRunId: runId },
      });
    }

    summary.remindersSummarized += reminderRows.length;
    summary.eventsDispatched += events.length;
    summary.summariesSent += 1;

    if (runId) {
      await prisma.cycleSummaryRun.update({
        where: { id: runId },
        data: {
          status: 'sent',
          // Named `eventCount` since the notification digest owned this table;
          // it now counts every source row the period summarized.
          eventCount: reminderRows.length + events.length,
          sentAt: now,
        },
      });
    }
  } catch (err) {
    if (runId) {
      // Leave the source rows un-summarized so the next period can pick them up
      // once the underlying failure is resolved.
      await prisma.cycleSummaryRun
        .update({ where: { id: runId }, data: { status: 'failed' } })
        .catch((updateErr) => {
          logger.error({
            msg: '[cycle-summary] Failed to mark run failed',
            orgId: organization.id,
            err: updateErr,
          });
        });
    }
    throw err;
  }
}

/**
 * Persist one recipient's email and the rows it covers atomically, then send it
 * outside the transaction — a slow SMTP round-trip must never hold a DB
 * transaction open, and a send failure must not roll back the record of what was
 * already captured.
 */
async function deliverBucket(params: {
  bucket: RecipientBucket;
  organization: { id: string; name: string };
  facilityNames: Map<string, string>;
  periodKey: string;
  runId: string | null;
  now: Date;
  sendEmail: CycleSummarySender;
  summary: CycleSummaryRunSummary;
}): Promise<void> {
  const { bucket, organization, facilityNames, periodKey, runId, now, sendEmail, summary } = params;

  const sections = buildCycleSummarySections({
    reminders: bucket.reminders,
    organizationUpdates: buildSections(bucket.events, facilityNames),
  });

  if (sections.length === 0) return;

  const emailMessage = await prisma.$transaction(async (tx) => {
    const record = await tx.emailMessage.create({
      data: {
        toEmail: bucket.email,
        toName: bucket.name,
        kind: CYCLE_SUMMARY_EMAIL_KIND,
        organizationId: organization.id,
        status: 'queued',
      },
      select: { id: true },
    });

    const items = [
      ...bucket.reminders.map((item) => ({
        emailMessageId: record.id,
        itemType: item.itemType,
        itemId: item.id,
      })),
      ...bucket.events.map((event) => ({
        emailMessageId: record.id,
        itemType: 'notification_event',
        itemId: event.id,
      })),
    ];
    if (items.length > 0) {
      // A learner who is also their own escalation target legitimately holds two
      // copies of one row; skipDuplicates absorbs that and any retry re-insert.
      await tx.cycleSummaryItem.createMany({ data: items, skipDuplicates: true });
    }

    const logIds = bucket.reminders
      .filter((item) => item.itemType === 'reminder_log')
      .map((item) => item.id);
    const nudgeIds = bucket.reminders
      .filter((item) => item.itemType === 'reminder_nudge')
      .map((item) => item.id);

    if (logIds.length > 0) {
      await tx.reminderLog.updateMany({
        where: { id: { in: logIds }, summarizedAt: null },
        data: { summarizedAt: now },
      });
    }
    if (nudgeIds.length > 0) {
      await tx.reminderNudge.updateMany({
        where: { id: { in: nudgeIds }, summarizedAt: null },
        data: { summarizedAt: now },
      });
    }
    if (bucket.events.length > 0) {
      await tx.notificationEvent.updateMany({
        where: { id: { in: bucket.events.map((e) => e.id) }, status: 'pending' },
        data: { status: 'dispatched', dispatchedAt: now, digestRunId: runId },
      });
    }

    return record;
  });

  let delivery: CycleSummaryDeliveryResult;
  try {
    delivery = await sendEmail({
      to: bucket.email,
      toName: bucket.name,
      organizationName: organization.name,
      periodKey,
      sections,
      itemCount: countSectionItems(sections),
    });
  } catch (err) {
    delivery = { ok: false, error: err };
  }

  if (delivery.ok) {
    summary.emailsSent += 1;
  } else {
    summary.errors += 1;
    logger.error({
      msg: '[cycle-summary] Summary email failed — not re-summarized',
      orgId: organization.id,
      organizationUserId: bucket.organizationUserId,
      to: maskEmail(bucket.email),
      err: delivery.error,
    });
  }

  await finalizeEmailMessage(emailMessage.id, delivery);
}

/** Trim an unknown transport error down to a persistable message string. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown email transport error';
}

/** Stamp the terminal delivery state on an EmailMessage row. Never throws. */
async function finalizeEmailMessage(
  id: string,
  delivery: CycleSummaryDeliveryResult,
): Promise<void> {
  try {
    if (delivery.ok) {
      await prisma.emailMessage.update({
        where: { id },
        data: { status: 'sent', sentAt: new Date() },
      });
    } else {
      await prisma.emailMessage.update({
        where: { id },
        data: {
          status: 'failed',
          attempts: { increment: 1 },
          lastError: describeError(delivery.error),
        },
      });
    }
  } catch (err) {
    logger.error({
      msg: '[cycle-summary] Failed to finalize email delivery',
      emailMessageId: id,
      err,
    });
  }
}
