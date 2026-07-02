import { logger } from '@/lib/logger';
import {
  sendDeadlineReminderEmail,
  sendDeadlineOverdueWorkerEmail,
  sendEscalationEmail,
  sendRetakeReminderEmail,
} from '@/lib/email';
import type { ReminderEmailMessage, ReminderEmailSender } from './dispatch';

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
 * any unexpected failure so a single bad send can't abort the sweep.
 */

/** Where escalation recipients land — the admin compliance surface (Phase 8). */
const COMPLIANCE_LINK = '/dashboard/compliance';

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

async function routeEmail(message: ReminderEmailMessage): Promise<void> {
  const recipientName = message.toName?.trim() || 'there';
  const workerName = message.workerName ?? message.toName ?? message.to;
  const daysOverdue = message.daysOverdue ?? 0;

  // Track B recurring nudges.
  if (message.kind) {
    switch (message.kind) {
      case 'WORKER_RETAKE':
        await sendRetakeReminderEmail(
          message.to,
          recipientName,
          message.courseTitle,
          message.attemptsRemaining ?? 0,
        );
        return;
      case 'ADMIN_REASSIGN':
        await sendEscalationEmail(
          message.to,
          recipientName,
          workerName,
          message.courseTitle,
          message.dueAt,
          daysOverdue,
          escalationStageLabel(message),
          COMPLIANCE_LINK,
        );
        return;
    }
  }

  // Track A ladder stages.
  if (message.stage) {
    switch (message.stage) {
      case 'FRIENDLY_REMINDER':
        await sendDeadlineReminderEmail(
          message.to,
          recipientName,
          message.courseTitle,
          message.dueAt,
          'friendly',
        );
        return;
      case 'URGENT_REMINDER':
        await sendDeadlineReminderEmail(
          message.to,
          recipientName,
          message.courseTitle,
          message.dueAt,
          'urgent',
        );
        return;
      case 'DAY_OF_DEADLINE':
        await sendDeadlineReminderEmail(
          message.to,
          recipientName,
          message.courseTitle,
          message.dueAt,
          'day_of',
        );
        return;
      case 'GRACE_SOFT_ESCALATION':
        if (message.recipientRole === 'worker') {
          await sendDeadlineOverdueWorkerEmail(
            message.to,
            recipientName,
            message.courseTitle,
            message.dueAt,
            daysOverdue,
          );
        } else {
          await sendEscalationEmail(
            message.to,
            recipientName,
            workerName,
            message.courseTitle,
            message.dueAt,
            daysOverdue,
            escalationStageLabel(message),
            COMPLIANCE_LINK,
          );
        }
        return;
      case 'HARD_ESCALATION':
        await sendEscalationEmail(
          message.to,
          recipientName,
          workerName,
          message.courseTitle,
          message.dueAt,
          daysOverdue,
          escalationStageLabel(message),
          COMPLIANCE_LINK,
        );
        return;
      case 'INITIAL_LAUNCH':
        // The launch email is sent by the assign flow (Phase 7), never the sweep.
        return;
    }
  }

  logger.warn({
    msg: '[reminders] Email sender — no template matched message',
    stage: message.stage,
    kind: message.kind,
    recipientRole: message.recipientRole,
  });
}

export const reminderEmailSender: ReminderEmailSender = async (message) => {
  try {
    await routeEmail(message);
  } catch (err) {
    logger.error({
      msg: '[reminders] Email sender failed',
      stage: message.stage,
      kind: message.kind,
      recipientRole: message.recipientRole,
      err,
    });
  }
};
