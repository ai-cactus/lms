import prisma from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import type { ReminderStage, ReminderNudgeKind } from '@/generated/prisma/enums';
import { logger, maskEmail } from '@/lib/logger';
import { createNotification } from '@/app/actions/notifications';
import { REMINDER_STAGE_DEFAULTS } from './stages';
import { resolveEscalationRecipients, type EscalationRecipients } from './recipients';
import { diffInDaysInTz } from './time';

/**
 * Reminder dispatch service.
 *
 * Writes the dedup record first, then fans out to in-app notifications and
 * email. Designed to NEVER throw — every public entry point returns a structured
 * result and logs failures with the `[reminders]` prefix (mirroring the
 * non-throwing `createNotification`).
 */

/**
 * A single reminder email to send. Carries enough context for Phase 4 to pick
 * the right Nodemailer template (`src/lib/email.ts`) without this module taking
 * a forward dependency on templates that don't exist yet.
 */
export interface ReminderEmailMessage {
  to: string;
  toName: string | null;
  /** Set for ladder emails. */
  stage?: ReminderStage;
  /** Set for Track B nudge emails. */
  kind?: ReminderNudgeKind;
  /** Whether this email targets the worker or an escalation recipient. */
  recipientRole: 'worker' | 'escalation';
  courseTitle: string;
  /** The enrollment deadline, for copy; null for Track B nudges. */
  dueAt: Date | null;
  /**
   * The worker's display name. On escalation emails the worker is the *subject*
   * of the copy (not the recipient), so this is carried separately from
   * `toName` (which is the recipient's name).
   */
  workerName?: string;
  /** Whole days past the deadline — used by overdue/escalation copy. */
  daysOverdue?: number;
  /** Remaining quiz attempts — used by the `WORKER_RETAKE` nudge copy. */
  attemptsRemaining?: number;
}

/**
 * Outcome of a single email delivery attempt. The sender surfaces the *real*
 * transport result (F-021) so dispatch can persist an accurate EmailMessage
 * status instead of silently dropping a failed send (F-020).
 */
export interface EmailDeliveryResult {
  ok: boolean;
  /** Transport error on failure; used only for the EmailMessage `lastError`. */
  error?: unknown;
}

/**
 * Pluggable email sender. Phase 4 injects the real template-backed sender; until
 * then dispatch uses {@link noopEmailSender}. Returns the real delivery result so
 * dispatch can record delivery/bounce state on the {@link ReminderEmailMessage}'s
 * EmailMessage row.
 */
export type ReminderEmailSender = (message: ReminderEmailMessage) => Promise<EmailDeliveryResult>;

/** Default sender: logs that email delivery is pending the Phase 4 wiring. */
export const noopEmailSender: ReminderEmailSender = async (message) => {
  logger.info({
    msg: '[reminders] email pending Phase 4 — no-op sender',
    to: maskEmail(message.to),
    stage: message.stage,
    kind: message.kind,
    recipientRole: message.recipientRole,
  });
  return { ok: true };
};

/** EmailMessage `kind` for ladder-stage sends (Track A). */
const EMAIL_KIND_STAGE = 'reminder_stage';
/** EmailMessage `kind` for recurring nudge sends (Track B). */
const EMAIL_KIND_NUDGE = 'reminder_nudge';

/** Trim an unknown transport error down to a persistable message string. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown email transport error';
}

/**
 * Deliver one reminder email and record it as the delivery source of truth.
 *
 * Creates an EmailMessage row (`queued`), attempts delivery, then transitions it
 * to `sent` (with `sentAt`) or `failed` (incrementing `attempts`, storing
 * `lastError`) based on the real transport result. The ladder/nudge dedup rows
 * mean "stage claimed"; this row means "message delivered" — decoupling the two
 * so a failed send is retried by the sweep instead of being permanently
 * suppressed (F-020/F-021).
 *
 * Never throws: tracking and transport failures are isolated so one bad send
 * can neither abort the dispatch nor re-fire the already-sent notification.
 */
async function deliverReminderEmail(params: {
  sendEmail: ReminderEmailSender;
  message: ReminderEmailMessage;
  kind: string;
  /** ReminderLog id for ladder sends; null for nudges (no ReminderLog exists). */
  reminderLogId: string | null;
}): Promise<void> {
  const { sendEmail, message, kind, reminderLogId } = params;

  let record: { id: string } | null = null;
  try {
    record = await prisma.emailMessage.create({
      data: { toEmail: message.to, kind, reminderLogId, status: 'queued' },
    });
  } catch (err) {
    logger.error({ msg: '[reminders] Failed to record queued email', kind, reminderLogId, err });
  }

  let delivery: EmailDeliveryResult;
  try {
    delivery = await sendEmail(message);
  } catch (err) {
    delivery = { ok: false, error: err };
  }

  if (record) {
    await finalizeEmailMessage(record.id, delivery);
  }
}

/** Stamp the terminal delivery state on an EmailMessage row. Never throws. */
async function finalizeEmailMessage(id: string, delivery: EmailDeliveryResult): Promise<void> {
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
    logger.error({ msg: '[reminders] Failed to finalize email delivery', emailMessageId: id, err });
  }
}

/** Resolved inputs the sweep hands to {@link retryReminderEmail} per failed row. */
export interface ReminderEmailRetryInput {
  sendEmail: ReminderEmailSender;
  /** The failed EmailMessage being re-attempted. */
  emailMessage: { id: string; toEmail: string };
  /** Claimed ladder stage (from the linked ReminderLog). */
  stage: ReminderStage;
  /** The stage's stored target date — recomputes `daysOverdue` for the copy. */
  targetDate: Date;
  courseTitle: string;
  dueAt: Date | null;
  timezone: string;
  /** The subject worker — determines recipientRole vs. the stored `toEmail`. */
  worker: { email: string; name: string | null };
}

/**
 * Re-attempt a previously failed reminder-ladder email (sweep retry pre-pass,
 * F-020). Reconstructs the {@link ReminderEmailMessage} from the claimed
 * ReminderLog + enrollment context, resends via the injected sender, and stamps
 * the terminal state on the EmailMessage row. Returns whether the resend
 * succeeded. Never throws — a failed resend leaves the row `failed` with an
 * incremented `attempts` so the cap eventually stops it.
 */
export async function retryReminderEmail(input: ReminderEmailRetryInput): Promise<boolean> {
  const { sendEmail, emailMessage, stage, targetDate, courseTitle, dueAt, timezone, worker } =
    input;

  const recipientRole = emailMessage.toEmail === worker.email ? 'worker' : 'escalation';
  const workerName = worker.name ?? worker.email;
  const daysOverdue = dueAt ? Math.max(0, diffInDaysInTz(targetDate, dueAt, timezone)) : 0;

  const message: ReminderEmailMessage = {
    to: emailMessage.toEmail,
    toName: recipientRole === 'worker' ? worker.name : null,
    stage,
    recipientRole,
    courseTitle,
    dueAt,
    workerName,
    daysOverdue,
  };

  let delivery: EmailDeliveryResult;
  try {
    delivery = await sendEmail(message);
  } catch (err) {
    delivery = { ok: false, error: err };
  }

  await finalizeEmailMessage(emailMessage.id, delivery);
  return delivery.ok;
}

export type DispatchReason = 'sent' | 'dry-run' | 'duplicate' | 'throttled' | 'error';

export interface DispatchResult {
  sent: boolean;
  reason: DispatchReason;
}

/**
 * Map a ladder stage to its in-app notification type. These type strings are
 * added to the notification UI catalog in Phase 5; using them now is safe (the
 * `Notification.type` column is a plain string).
 */
export function stageToNotificationType(stage: ReminderStage): string {
  switch (stage) {
    case 'FRIENDLY_REMINDER':
    case 'URGENT_REMINDER':
    case 'DAY_OF_DEADLINE':
      return 'COURSE_DEADLINE_REMINDER';
    case 'GRACE_SOFT_ESCALATION':
      // Worker-facing side of the soft escalation.
      return 'COURSE_OVERDUE';
    case 'HARD_ESCALATION':
      return 'COMPLIANCE_ESCALATION';
    case 'INITIAL_LAUNCH':
      // Not dispatched by the sweep; included for exhaustiveness.
      return 'COURSE_DEADLINE_REMINDER';
  }
}

function workerStageCopy(
  stage: ReminderStage,
  courseTitle: string,
): { title: string; message: string } {
  switch (stage) {
    case 'FRIENDLY_REMINDER':
      return {
        title: 'Upcoming training deadline',
        message: `"${courseTitle}" is due soon. Please complete it before the deadline.`,
      };
    case 'URGENT_REMINDER':
      return {
        title: 'Training deadline approaching',
        message: `"${courseTitle}" is due in a few days. Please complete it as soon as you can.`,
      };
    case 'DAY_OF_DEADLINE':
      return {
        title: 'Training due today',
        message: `"${courseTitle}" is due today. Please complete it before the end of the day.`,
      };
    case 'GRACE_SOFT_ESCALATION':
      return {
        title: 'Training overdue',
        message: `"${courseTitle}" is now overdue. Please complete it as soon as possible.`,
      };
    default:
      return {
        title: 'Training reminder',
        message: `Please complete "${courseTitle}".`,
      };
  }
}

function escalationStageCopy(
  stage: ReminderStage,
  courseTitle: string,
  workerName: string,
): { title: string; message: string } {
  if (stage === 'HARD_ESCALATION') {
    return {
      title: 'Compliance escalation',
      message: `${workerName}'s training "${courseTitle}" remains incomplete past its deadline and requires attention.`,
    };
  }
  return {
    title: 'Worker training overdue',
    message: `${workerName}'s training "${courseTitle}" is overdue.`,
  };
}

export interface LadderStageInput {
  enrollment: { id: string; userId: string; courseId: string };
  courseTitle: string;
  worker: { id: string; email: string; name: string | null };
  stage: ReminderStage;
  /** Effective channels for this stage (`'email'`, `'in_app'`). */
  channels: string[];
  /** The computed local target date for this stage (stored on the log row). */
  targetDate: Date;
  /** The enrollment deadline, passed through to email copy. */
  dueAt: Date | null;
  /** Organization timezone (informational; copy/formatting in Phase 4). */
  timezone: string;
  dryRun: boolean;
  /** Injected email sender; defaults to {@link noopEmailSender}. */
  sendEmail?: ReminderEmailSender;
}

/**
 * Dispatch a single ladder stage for an enrollment. Idempotent via the
 * `ReminderLog (enrollmentId, stage)` unique constraint: we create the log row
 * first and treat a `P2002` as "already sent" so a concurrent sweep can never
 * double-send.
 */
export async function dispatchLadderStage(input: LadderStageInput): Promise<DispatchResult> {
  const { enrollment, courseTitle, worker, stage, channels, targetDate, dueAt, timezone, dryRun } =
    input;
  const sendEmail = input.sendEmail ?? noopEmailSender;
  // Days past the deadline at fire-time. `targetDate` is the deadline's local
  // start-of-day plus the stage offset, so this resolves to the (non-negative)
  // overdue count for the escalation/overdue stages and 0 for pre-deadline ones.
  const daysOverdue = dueAt ? Math.max(0, diffInDaysInTz(targetDate, dueAt, timezone)) : 0;
  const audience = REMINDER_STAGE_DEFAULTS[stage].audience;
  const wantsEmail = channels.includes('email');
  const wantsInApp = channels.includes('in_app');

  if (dryRun) {
    logger.info({
      msg: '[reminders] DRY RUN — would dispatch ladder stage',
      enrollmentId: enrollment.id,
      stage,
      audience,
      channels,
    });
    return { sent: false, reason: 'dry-run' };
  }

  try {
    // Dedup: create the log row FIRST; a concurrent run loses the race via P2002.
    // The log means "stage claimed"; delivery is tracked separately per-email on
    // EmailMessage (keyed by this log id) so a failed send doesn't suppress retry.
    let reminderLog: { id: string };
    try {
      reminderLog = await prisma.reminderLog.create({
        data: { enrollmentId: enrollment.id, stage, channels, targetDate },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { sent: false, reason: 'duplicate' };
      }
      throw err;
    }

    const metadata = { enrollmentId: enrollment.id, courseId: enrollment.courseId, stage };

    if (audience === 'worker' || audience === 'worker_and_escalation') {
      const copy = workerStageCopy(stage, courseTitle);
      if (wantsInApp) {
        await createNotification({
          userId: worker.id,
          type: stageToNotificationType(stage),
          title: copy.title,
          message: copy.message,
          linkUrl: '/worker/trainings',
          metadata,
        });
      }
      if (wantsEmail) {
        await deliverReminderEmail({
          sendEmail,
          kind: EMAIL_KIND_STAGE,
          reminderLogId: reminderLog.id,
          message: {
            to: worker.email,
            toName: worker.name,
            stage,
            recipientRole: 'worker',
            courseTitle,
            dueAt,
            workerName: worker.name ?? worker.email,
            daysOverdue,
          },
        });
      }
    }

    if (audience === 'escalation' || audience === 'worker_and_escalation') {
      const recipients = await resolveEscalationRecipients({ userId: enrollment.userId });
      const workerName = worker.name ?? worker.email;
      const copy = escalationStageCopy(stage, courseTitle, workerName);

      if (wantsInApp) {
        for (const userId of recipients.userIds) {
          await createNotification({
            userId,
            type: 'COMPLIANCE_ESCALATION',
            title: copy.title,
            message: copy.message,
            linkUrl: '/dashboard/status-tracker',
            metadata,
          });
        }
      }
      if (wantsEmail) {
        for (const recipient of recipients.emails) {
          await deliverReminderEmail({
            sendEmail,
            kind: EMAIL_KIND_STAGE,
            reminderLogId: reminderLog.id,
            message: {
              to: recipient.email,
              toName: recipient.name,
              stage,
              recipientRole: 'escalation',
              courseTitle,
              dueAt,
              workerName,
              daysOverdue,
            },
          });
        }
      }
    }

    logger.info({
      msg: '[reminders] Dispatched ladder stage',
      enrollmentId: enrollment.id,
      stage,
      audience,
    });
    return { sent: true, reason: 'sent' };
  } catch (err) {
    logger.error({
      msg: '[reminders] Failed to dispatch ladder stage',
      enrollmentId: enrollment.id,
      stage,
      err,
    });
    return { sent: false, reason: 'error' };
  }
}

export interface NudgeInput {
  kind: ReminderNudgeKind;
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  worker: { id: string; email: string; name: string | null };
  /** Escalation targets — used for `ADMIN_REASSIGN`. */
  recipients: EscalationRecipients;
  /** Minimum days between nudges of this kind for this enrollment. */
  nudgeIntervalDays: number;
  /** Remaining quiz attempts — surfaced in the `WORKER_RETAKE` email copy. */
  attemptsRemaining?: number;
  now: Date;
  dryRun: boolean;
  sendEmail?: ReminderEmailSender;
}

/**
 * Dispatch a Track B recurring nudge, throttled per `(enrollmentId, kind)` by
 * `ReminderNudge.lastSentAt`. `WORKER_RETAKE` nudges the worker to use remaining
 * attempts; `ADMIN_REASSIGN` nudges admins/manager to assign a retake (reusing
 * the existing `QUIZ_RETRY_LIMIT_REACHED` type, which `assignRetake` resolves).
 */
export async function dispatchNudge(input: NudgeInput): Promise<DispatchResult> {
  const {
    kind,
    enrollmentId,
    courseId,
    courseTitle,
    worker,
    recipients,
    nudgeIntervalDays,
    now,
    dryRun,
  } = input;
  const sendEmail = input.sendEmail ?? noopEmailSender;

  try {
    const existing = await prisma.reminderNudge.findUnique({
      where: { enrollmentId_kind: { enrollmentId, kind } },
      select: { lastSentAt: true },
    });

    if (existing) {
      const elapsedMs = now.getTime() - existing.lastSentAt.getTime();
      const intervalMs = nudgeIntervalDays * 24 * 60 * 60 * 1000;
      if (elapsedMs < intervalMs) {
        return { sent: false, reason: 'throttled' };
      }
    }

    if (dryRun) {
      logger.info({ msg: '[reminders] DRY RUN — would dispatch nudge', enrollmentId, kind });
      return { sent: false, reason: 'dry-run' };
    }

    const metadata = { enrollmentId, courseId, kind };

    if (kind === 'WORKER_RETAKE') {
      await createNotification({
        userId: worker.id,
        type: 'COURSE_RETAKE_REMINDER',
        title: 'Retake your quiz',
        message: `You still have attempts remaining for "${courseTitle}". Please retake the quiz before your deadline.`,
        linkUrl: '/worker/trainings',
        metadata,
      });
      await deliverReminderEmail({
        sendEmail,
        kind: EMAIL_KIND_NUDGE,
        reminderLogId: null,
        message: {
          to: worker.email,
          toName: worker.name,
          kind,
          recipientRole: 'worker',
          courseTitle,
          dueAt: null,
          attemptsRemaining: input.attemptsRemaining,
        },
      });
    } else {
      const workerName = worker.name ?? worker.email;
      for (const userId of recipients.userIds) {
        await createNotification({
          userId,
          type: 'QUIZ_RETRY_LIMIT_REACHED',
          title: 'Quiz attempts exhausted',
          message: `${workerName} has exhausted all quiz attempts for "${courseTitle}" and needs a retake assignment.`,
          linkUrl: `/dashboard/staff/${worker.id}`,
          metadata,
        });
      }
      for (const recipient of recipients.emails) {
        await deliverReminderEmail({
          sendEmail,
          kind: EMAIL_KIND_NUDGE,
          reminderLogId: null,
          message: {
            to: recipient.email,
            toName: recipient.name,
            kind,
            recipientRole: 'escalation',
            courseTitle,
            dueAt: null,
            workerName,
          },
        });
      }
    }

    await prisma.reminderNudge.upsert({
      where: { enrollmentId_kind: { enrollmentId, kind } },
      create: { enrollmentId, kind, lastSentAt: now, count: 1 },
      update: { lastSentAt: now, count: { increment: 1 } },
    });

    logger.info({ msg: '[reminders] Dispatched nudge', enrollmentId, kind });
    return { sent: true, reason: 'sent' };
  } catch (err) {
    logger.error({ msg: '[reminders] Failed to dispatch nudge', enrollmentId, kind, err });
    return { sent: false, reason: 'error' };
  }
}
