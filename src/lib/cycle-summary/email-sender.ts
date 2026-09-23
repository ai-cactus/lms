import { logger } from '@/lib/logger';
import { sendCycleSummaryEmail, type CycleSummaryEmailSection } from '@/lib/email';
import type { CycleSummarySender } from './compose';
import type { CycleSummarySection } from './sections';

/**
 * Real, template-backed cycle-summary email sender.
 *
 * Maps an abstract `CycleSummaryMessage` (produced by `compose.ts`) onto
 * the Nodemailer template in `src/lib/email.ts`. The compose logic is
 * deliberately decoupled from the templates (it defaults to a no-op sender); the
 * worker injects this so the scheduled run actually delivers mail. Mirrors
 * `src/lib/notifications/email-sender.ts`.
 *
 * Never throws — a single bad send can't abort the run.
 */

/** Where summary recipients land. */
const DASHBOARD_LINK = '/dashboard';

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
 * Human-readable date from the machine period key
 * (`daily:2026-09-23` → "September 23, 2026"). Falls back to the raw value when
 * the key is not the expected shape, so a malformed key degrades the subject
 * line rather than the send.
 */
export function summaryDateLabel(periodKey: string): string {
  const value = periodKey.slice(periodKey.indexOf(':') + 1);
  const [year, month, day] = value.split('-');
  const monthName = MONTHS[Number(month) - 1];
  return monthName && year && day ? `${monthName} ${Number(day)}, ${year}` : value;
}

/** Map one domain section onto its presentation counterpart. */
function toEmailSection(section: CycleSummarySection): CycleSummaryEmailSection {
  switch (section.id) {
    case 'training_due':
    case 'training_upcoming':
      return {
        kind: 'training',
        title: section.title,
        items: section.items.map((item) => ({
          courseTitle: item.courseTitle,
          detail: item.detail,
        })),
      };
    case 'team_compliance':
      return {
        kind: 'team',
        title: section.title,
        groups: section.groups.map((group) => ({
          workerName: group.workerName,
          items: group.items.map((item) => ({
            courseTitle: item.courseTitle,
            detail: item.detail,
          })),
        })),
      };
    case 'organization_updates':
      return { kind: 'updates', title: section.title, sections: section.sections };
  }
}

export const cycleSummaryEmailSender: CycleSummarySender = async (message) => {
  try {
    const result = await sendCycleSummaryEmail(message.to, message.toName, {
      organizationName: message.organizationName,
      dateLabel: summaryDateLabel(message.periodKey),
      sections: message.sections.map(toEmailSection),
      actionLabel: 'Open Theraptly',
      actionLink: DASHBOARD_LINK,
    });
    return { ok: result.success, error: result.error };
  } catch (err) {
    logger.error({
      msg: '[cycle-summary] Email sender failed',
      periodKey: message.periodKey,
      err,
    });
    return { ok: false, error: err };
  }
};
