import { logger } from '@/lib/logger';
import {
  sendDeadlineReminderEmail,
  sendDeadlineOverdueWorkerEmail,
  sendEscalationEmail,
  sendRetakeReminderEmail,
} from '@/lib/email';
import type { EmailDeliveryResult, ReminderEmailMessage, ReminderEmailSender } from './dispatch';

/**
 * Real, template-backed reminder email sender.
 *
 * Maps an abstract {@link ReminderEmailMessage} (produced by `dispatch.ts`) to
 * the concrete Nodemailer template in `src/lib/email.ts`. The dispatch layer is
 * deliberately decoupled from the templates (it defaults to a no-op sender); the
 * worker injects this sender so the daily sweep actually delivers mail.
 *
 * Never throws: the underlying email helpers already swallow transport errors
 * and return a structured result, and this wrapper additionally guards against
 * any unexpected failure so a single bad send can't abort the sweep. The real
 * transport outcome is threaded back to dispatch (F-021) so a failed send is
 * recorded on its EmailMessage row and retried, rather than silently dropped.
 */

/** Where escalation recipients land — the admin status-tracker surface (Phase 8). */
const STATUS_TRACKER_LINK = '/dashboard/status-tracker';

/** Map an `@/lib/email` sender result onto the dispatch delivery contract. */
function toDelivery(result: { success: boolean; error?: unknown }): EmailDeliveryResult {
  return { ok: result.success, error: result.error };
}

/** Human-readable escalation-stage label for the manager/admin email copy. */
function escalationStageLabel(message: ReminderEmailMessage): string {
  if (message.kind === 'ADMIN_REASSIGN') return 'Re-assignment needed';
  switch (message.stage) {
    case 'GRACE_SOFT_ESCALATION':
      return 'Soft escalation (grace period)';
    case 'HARD_ESCALATION':
      return 'Hard escalation';
    default:
      return 'Compliance escalation';
  }
}

async function routeEmail(message: ReminderEmailMessage): Promise<EmailDeliveryResult> {
  const recipientName = message.toName?.trim() || 'there';
  const workerName = message.workerName ?? message.toName ?? message.to;
  const daysOverdue = message.daysOverdue ?? 0;

  // Track B recurring nudges.
  if (message.kind) {
    switch (message.kind) {
      case 'WORKER_RETAKE':
        return toDelivery(
          await sendRetakeReminderEmail(
            message.to,
            recipientName,
            message.courseTitle,
            message.attemptsRemaining ?? 0,
          ),
        );
      case 'ADMIN_REASSIGN':
        return toDelivery(
          await sendEscalationEmail(
            message.to,
            recipientName,
            workerName,
            message.courseTitle,
            message.dueAt,
            daysOverdue,
            escalationStageLabel(message),
            STATUS_TRACKER_LINK,
          ),
        );
    }
  }

  // Track A ladder stages.
  if (message.stage) {
    switch (message.stage) {
      case 'FRIENDLY_REMINDER':
        return toDelivery(
          await sendDeadlineReminderEmail(
            message.to,
            recipientName,
            message.courseTitle,
            message.dueAt,
            'friendly',
          ),
        );
      case 'URGENT_REMINDER':
        return toDelivery(
          await sendDeadlineReminderEmail(
            message.to,
            recipientName,
            message.courseTitle,
            message.dueAt,
            'urgent',
          ),
        );
      case 'DAY_OF_DEADLINE':
        return toDelivery(
          await sendDeadlineReminderEmail(
            message.to,
            recipientName,
            message.courseTitle,
            message.dueAt,
            'day_of',
          ),
        );
      case 'GRACE_SOFT_ESCALATION':
        if (message.recipientRole === 'worker') {
          return toDelivery(
            await sendDeadlineOverdueWorkerEmail(
              message.to,
              recipientName,
              message.courseTitle,
              message.dueAt,
              daysOverdue,
            ),
          );
        }
        return toDelivery(
          await sendEscalationEmail(
            message.to,
            recipientName,
            workerName,
            message.courseTitle,
            message.dueAt,
            daysOverdue,
            escalationStageLabel(message),
            STATUS_TRACKER_LINK,
          ),
        );
      case 'HARD_ESCALATION':
        return toDelivery(
          await sendEscalationEmail(
            message.to,
            recipientName,
            workerName,
            message.courseTitle,
            message.dueAt,
            daysOverdue,
            escalationStageLabel(message),
            STATUS_TRACKER_LINK,
          ),
        );
      case 'INITIAL_LAUNCH':
        // The launch email is sent by the assign flow (Phase 7), never the sweep.
        // Nothing to deliver here — treat as a successful no-op.
        return { ok: true };
    }
  }

  logger.warn({
    msg: '[reminders] Email sender — no template matched message',
    stage: message.stage,
    kind: message.kind,
    recipientRole: message.recipientRole,
  });
  return { ok: false, error: 'No email template matched message' };
}

export const reminderEmailSender: ReminderEmailSender = async (message) => {
  try {
    return await routeEmail(message);
  } catch (err) {
    logger.error({
      msg: '[reminders] Email sender failed',
      stage: message.stage,
      kind: message.kind,
      recipientRole: message.recipientRole,
      err,
    });
    return { ok: false, error: err };
  }
};
