import { logger } from '@/lib/logger';
import { sendNotificationDigestEmail } from '@/lib/email';
import type { DigestFrequency } from '@/generated/prisma/enums';
import type { NotificationDigestSender } from './digest';

/**
 * Real, template-backed digest email sender.
 *
 * Maps an abstract `NotificationDigestMessage` (produced by `digest.ts`) onto
 * the Nodemailer template in `src/lib/email.ts`. The digest logic is
 * deliberately decoupled from the templates (it defaults to a no-op sender); the
 * worker injects this so the scheduled run actually delivers mail. Mirrors
 * `src/lib/reminders/email-sender.ts`.
 *
 * Never throws — a single bad send can't abort the run.
 */

/** Where digest recipients land. */
const DASHBOARD_LINK = '/dashboard/notifications';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Human-readable period from the machine period key
 * (`daily:2026-08-03` → "Daily summary — August 3, 2026").
 */
export function periodLabelFor(frequency: DigestFrequency, periodKey: string): string {
  const value = periodKey.slice(periodKey.indexOf(':') + 1);

  if (frequency === 'weekly') {
    const [year, week] = value.split('-W');
    return week ? `Weekly summary — week ${Number(week)}, ${year}` : 'Weekly summary';
  }

  const [year, month, day] = value.split('-');
  const monthName = MONTHS[Number(month) - 1];
  return monthName ? `Daily summary — ${monthName} ${Number(day)}, ${year}` : 'Daily summary';
}

export const notificationDigestSender: NotificationDigestSender = async (message) => {
  try {
    const result = await sendNotificationDigestEmail(message.to, message.toName, {
      organizationName: message.organizationName,
      periodLabel: periodLabelFor(message.frequency, message.periodKey),
      totalCount: message.totalCount,
      sections: message.sections,
      actionLabel: 'View notifications',
      actionLink: DASHBOARD_LINK,
    });
    return { ok: result.success, error: result.error };
  } catch (err) {
    logger.error({
      msg: '[notifications] Digest email sender failed',
      periodKey: message.periodKey,
      err,
    });
    return { ok: false, error: err };
  }
};
