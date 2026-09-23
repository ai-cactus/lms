import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';
import { buildSections, type PendingEvent } from '@/lib/notifications/digest';
import {
  CYCLE_SUMMARY_EMAIL_KIND,
  ENROLLMENT_CONTEXT_SELECT,
  noopCycleSummarySender,
  periodKeyForDay,
  toSourceRow,
  toSummaryItem,
  type CycleSummaryDeliveryResult,
  type CycleSummarySender,
  type ReminderSourceRow,
} from './compose';
import { buildCycleSummarySections, countSectionItems, type ReminderSummaryItem } from './sections';

/**
 * Cycle summary — delivery retry.
 *
 * Before the cutover, delivery was proved one message at a time: every reminder
 * email had its own `EmailMessage` row keyed to a `ReminderLog`, and the sweep's
 * retry pre-pass rebuilt and re-sent any that failed. The cutover collapses N
 * reminders into ONE email, so that per-message proof has to move with it —
 * otherwise a single failed send silently buries everything it carried, because
 * the compose pass has already stamped those rows `summarizedAt` and will never
 * gather them again.
 *
 * This pass is that second chance, and the only one: it re-sends a failed
 * summary from the `CycleSummaryItem` rows recorded alongside it, which is the
 * exact list of what that email was supposed to carry.
 *
 * Three properties the design turns on:
 *
 *   * NO DOUBLE SEND. The unit of retry is one `EmailMessage`, i.e. one
 *     recipient's copy. Source rows are deliberately shared — a learner's
 *     overdue course appears in their own email and in their manager's — so
 *     retrying by item would re-mail people who were already served. Retrying by
 *     message cannot: only rows still `failed` are selected, and the row's
 *     terminal state is stamped before the pass ends.
 *   * PARTIAL DEGRADATION, NOT FAILURE. An item whose source row is gone (an
 *     enrollment deleted, an event purged) is dropped from the rebuild and
 *     counted; the rest of the email still goes out. Only an email with nothing
 *     left to say is given up on.
 *   * BOUNDED. `attempts`/`maxAttempts` cap the re-sends exactly as they do for
 *     any other message, and a backoff floor keeps a transient outage from being
 *     hammered on back-to-back runs.
 *
 * Never throws: a per-message failure is isolated so one bad row cannot abort
 * the run that follows it.
 */

/**
 * A failed summary is only re-attempted once its last attempt is this old, so a
 * transient SMTP outage isn't retried on back-to-back runs. Mirrors the sweep's
 * `RETRY_BACKOFF_MS`.
 */
const RETRY_BACKOFF_MS = 60 * 60 * 1000; // 1 hour

export interface CycleSummaryRetryOptions {
  now: Date;
  /** When true, log intended re-sends and perform zero writes. */
  dryRun: boolean;
  /** Email transport injected by the worker (the real template-backed sender). */
  sendEmail?: CycleSummarySender;
}

export interface CycleSummaryRetrySummary {
  /** Failed summary emails eligible for another attempt. */
  candidates: number;
  resent: number;
  /** Re-sends that failed again — the row stays `failed` with one more attempt. */
  failed: number;
  /** Emails whose every item is gone, so there is nothing left to re-send. */
  unreconstructable: number;
  /** Individual source rows that could not be reconstructed but whose email could. */
  itemsUnavailable: number;
  /** Failed emails past their attempt cap; counted, never retried again. */
  exhausted: number;
  /** Re-sends a dry run would have made. Always 0 outside dry-run. */
  wouldResend: number;
  errors: number;
}

/** One recipient's failed email, with the rows it was supposed to carry. */
interface RetryCandidate {
  id: string;
  toEmail: string;
  toName: string | null;
  organizationId: string | null;
  createdAt: Date;
  items: { itemType: string; itemId: string }[];
}

export async function runCycleSummaryRetry(
  opts: CycleSummaryRetryOptions,
): Promise<CycleSummaryRetrySummary> {
  const { now, dryRun } = opts;
  const sendEmail = opts.sendEmail ?? noopCycleSummarySender;

  const summary: CycleSummaryRetrySummary = {
    candidates: 0,
    resent: 0,
    failed: 0,
    unreconstructable: 0,
    itemsUnavailable: 0,
    exhausted: 0,
    wouldResend: 0,
    errors: 0,
  };

  const backoffFloor = new Date(now.getTime() - RETRY_BACKOFF_MS);

  // Column-to-column comparison (attempts < maxAttempts) isn't expressible in a
  // Prisma filter, so gate on kind/status/backoff in SQL and cap in JS.
  const failedMessages = await prisma.emailMessage.findMany({
    where: {
      kind: CYCLE_SUMMARY_EMAIL_KIND,
      status: 'failed',
      updatedAt: { lt: backoffFloor },
    },
    select: {
      id: true,
      toEmail: true,
      toName: true,
      organizationId: true,
      attempts: true,
      maxAttempts: true,
      createdAt: true,
    },
  });

  const retryable = failedMessages.filter((m) => m.attempts < m.maxAttempts);
  summary.exhausted = failedMessages.length - retryable.length;
  summary.candidates = retryable.length;

  if (summary.exhausted > 0) {
    logger.warn({
      msg: '[cycle-summary] Failed summaries past their attempt cap — not retried',
      count: summary.exhausted,
    });
  }
  if (retryable.length === 0) return summary;

  const messageIds = retryable.map((m) => m.id);
  const itemRows = await prisma.cycleSummaryItem.findMany({
    where: { emailMessageId: { in: messageIds } },
    select: { emailMessageId: true, itemType: true, itemId: true },
  });

  const itemsByMessage = new Map<string, { itemType: string; itemId: string }[]>();
  for (const row of itemRows) {
    const bucket = itemsByMessage.get(row.emailMessageId);
    if (bucket) bucket.push({ itemType: row.itemType, itemId: row.itemId });
    else itemsByMessage.set(row.emailMessageId, [{ itemType: row.itemType, itemId: row.itemId }]);
  }

  const candidates: RetryCandidate[] = retryable.map((message) => ({
    id: message.id,
    toEmail: message.toEmail,
    toName: message.toName,
    organizationId: message.organizationId,
    createdAt: message.createdAt,
    items: itemsByMessage.get(message.id) ?? [],
  }));

  const context = await loadSourceContext(candidates);

  for (const candidate of candidates) {
    try {
      await retryOne({ candidate, context, now, dryRun, sendEmail, summary });
    } catch (err) {
      summary.errors += 1;
      logger.error({
        msg: '[cycle-summary] Summary retry failed',
        emailMessageId: candidate.id,
        err,
      });
    }
  }

  logger.info({ msg: '[cycle-summary] Retry pass complete', dryRun, ...summary });
  return summary;
}

/** Everything the candidates' items resolve to, loaded in one batch per table. */
interface SourceContext {
  logs: Map<string, ReminderSourceRow>;
  nudges: Map<string, ReminderSourceRow>;
  events: Map<string, PendingEvent>;
  facilityNames: Map<string, string>;
  organizationNames: Map<string, string>;
}

async function loadSourceContext(candidates: RetryCandidate[]): Promise<SourceContext> {
  const idsOf = (itemType: string): string[] => [
    ...new Set(
      candidates.flatMap((c) =>
        c.items.filter((i) => i.itemType === itemType).map((i) => i.itemId),
      ),
    ),
  ];

  const logIds = idsOf('reminder_log');
  const nudgeIds = idsOf('reminder_nudge');
  const eventIds = idsOf('notification_event');
  const organizationIds = [
    ...new Set(candidates.map((c) => c.organizationId).filter((id) => id !== null)),
  ];

  const [logs, nudges, events, organizations] = await Promise.all([
    logIds.length
      ? prisma.reminderLog.findMany({
          where: { id: { in: logIds } },
          select: { id: true, stage: true, enrollment: { select: ENROLLMENT_CONTEXT_SELECT } },
        })
      : Promise.resolve([]),
    nudgeIds.length
      ? prisma.reminderNudge.findMany({
          where: { id: { in: nudgeIds } },
          select: {
            id: true,
            kind: true,
            attemptsRemaining: true,
            enrollment: { select: ENROLLMENT_CONTEXT_SELECT },
          },
        })
      : Promise.resolve([]),
    eventIds.length
      ? prisma.notificationEvent.findMany({
          where: { id: { in: eventIds } },
          select: {
            id: true,
            facilityId: true,
            type: true,
            actorUserId: true,
            payload: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    organizationIds.length
      ? prisma.organization.findMany({
          where: { id: { in: organizationIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const facilityIds = [
    ...new Set(events.map((e) => e.facilityId).filter((id): id is string => id !== null)),
  ];
  const facilities = facilityIds.length
    ? await prisma.facility.findMany({
        where: { id: { in: facilityIds } },
        select: { id: true, name: true },
      })
    : [];

  return {
    logs: new Map(
      logs.map((log) => [
        log.id,
        toSourceRow(log.id, 'reminder_log', log.enrollment, { stage: log.stage }),
      ]),
    ),
    nudges: new Map(
      nudges.map((nudge) => [
        nudge.id,
        toSourceRow(nudge.id, 'reminder_nudge', nudge.enrollment, {
          kind: nudge.kind,
          attemptsRemaining: nudge.attemptsRemaining ?? undefined,
        }),
      ]),
    ),
    events: new Map(events.map((event) => [event.id, event as PendingEvent])),
    facilityNames: new Map(facilities.map((f) => [f.id, f.name])),
    organizationNames: new Map(organizations.map((o) => [o.id, o.name])),
  };
}

async function retryOne(params: {
  candidate: RetryCandidate;
  context: SourceContext;
  now: Date;
  dryRun: boolean;
  sendEmail: CycleSummarySender;
  summary: CycleSummaryRetrySummary;
}): Promise<void> {
  const { candidate, context, now, dryRun, sendEmail, summary } = params;

  const reminders: ReminderSummaryItem[] = [];
  const events: PendingEvent[] = [];
  let unavailable = 0;

  for (const item of candidate.items) {
    if (item.itemType === 'notification_event') {
      const event = context.events.get(item.itemId);
      if (event) events.push(event);
      else unavailable += 1;
      continue;
    }

    const row =
      item.itemType === 'reminder_log'
        ? context.logs.get(item.itemId)
        : context.nudges.get(item.itemId);
    if (!row) {
      unavailable += 1;
      continue;
    }

    // The item rows record WHAT the email carried, not which audience each line
    // was written for. The learner's own address is the discriminator, exactly
    // as the per-stage retry derived it: anyone else holding this row is an
    // escalation recipient.
    const recipientRole =
      row.workerEmail === candidate.toEmail ? ('worker' as const) : ('escalation' as const);
    reminders.push(toSummaryItem(row, recipientRole, now));
  }

  summary.itemsUnavailable += unavailable;

  const sections = buildCycleSummarySections({
    reminders,
    organizationUpdates: buildSections(events, context.facilityNames),
  });

  if (sections.length === 0) {
    summary.unreconstructable += 1;
    logger.warn({
      msg: '[cycle-summary] Failed summary can no longer be rebuilt — giving up on it',
      emailMessageId: candidate.id,
      to: maskEmail(candidate.toEmail),
      itemsUnavailable: unavailable,
    });
    if (!dryRun) {
      // Consume an attempt rather than leaving the row to be re-examined every
      // run forever: nothing about it can improve, and the cap retires it.
      await recordFailure(
        candidate.id,
        'Cycle summary could not be rebuilt — every source row it covered is gone',
      );
    }
    return;
  }

  const organizationName = candidate.organizationId
    ? (context.organizationNames.get(candidate.organizationId) ?? '')
    : '';

  if (dryRun) {
    summary.wouldResend += 1;
    logger.info({
      msg: '[cycle-summary] Dry run — failed summary not re-sent',
      emailMessageId: candidate.id,
      to: maskEmail(candidate.toEmail),
      itemCount: countSectionItems(sections),
      itemsUnavailable: unavailable,
    });
    return;
  }

  let delivery: CycleSummaryDeliveryResult;
  try {
    delivery = await sendEmail({
      to: candidate.toEmail,
      toName: candidate.toName,
      organizationName,
      // The period key isn't stored on the message; the email was composed by
      // the run that created it, so its creation day IS its period.
      periodKey: periodKeyForDay(candidate.createdAt),
      sections,
      itemCount: countSectionItems(sections),
    });
  } catch (err) {
    delivery = { ok: false, error: err };
  }

  if (delivery.ok) {
    summary.resent += 1;
    await recordSent(candidate.id);
    logger.info({
      msg: '[cycle-summary] Re-sent failed summary',
      emailMessageId: candidate.id,
      to: maskEmail(candidate.toEmail),
      itemsUnavailable: unavailable,
    });
    return;
  }

  summary.failed += 1;
  await recordFailure(candidate.id, describeError(delivery.error));
  logger.error({
    msg: '[cycle-summary] Summary re-send failed again',
    emailMessageId: candidate.id,
    to: maskEmail(candidate.toEmail),
    err: delivery.error,
  });
}

/** Trim an unknown transport error down to a persistable message string. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown email transport error';
}

/**
 * Stamp a re-sent message as delivered. Never throws: the mail is already gone,
 * so a bookkeeping failure must not be reported as a send failure — the row is
 * left `failed` and the next run re-sends it, which is the same exposure the
 * pre-cutover `finalizeEmailMessage` carries.
 */
async function recordSent(id: string): Promise<void> {
  try {
    await prisma.emailMessage.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date() },
    });
  } catch (err) {
    logger.error({
      msg: '[cycle-summary] Re-sent summary but failed to stamp it delivered',
      emailMessageId: id,
      err,
    });
  }
}

/**
 * Burn one attempt on a still-failed message. Never throws — a bookkeeping
 * failure must not abort the rest of the pass.
 */
async function recordFailure(id: string, lastError: string): Promise<void> {
  try {
    await prisma.emailMessage.update({
      where: { id },
      data: { status: 'failed', attempts: { increment: 1 }, lastError },
    });
  } catch (err) {
    logger.error({
      msg: '[cycle-summary] Failed to record retry outcome',
      emailMessageId: id,
      err,
    });
  }
}
