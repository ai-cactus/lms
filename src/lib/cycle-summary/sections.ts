import type { ReminderNudgeKind, ReminderStage } from '@/generated/prisma/enums';
import { REMINDER_STAGE_DEFAULTS } from '@/lib/reminders/stages';
import type { DigestSection } from '@/lib/notifications/digest';

/**
 * Cycle summary — pure section building.
 *
 * Turns one recipient's already-resolved reminder items (plus their
 * notification-digest sections) into the ordered, non-empty section list the
 * template renders. No I/O, no clock: every input is passed in so the shape of
 * an email is fully determined by its arguments.
 *
 * The four sections are fixed in this order, and an empty one is omitted:
 *
 *   1. Your training — overdue and due today   (the recipient's own learning)
 *   2. Your training — upcoming                (ditto, deadline not yet reached)
 *   3. Team & compliance                       (items about the recipient's reports)
 *   4. Organization updates                    (the notification digest, verbatim)
 *
 * A manager who is also a learner legitimately receives 1/2 *and* 3: the
 * sections answer different questions ("what do I owe?" vs "what does my team
 * owe?"), so neither suppresses the other.
 */

/** Which source table a summarized row came from — mirrors `CycleSummaryItem.itemType`. */
export type CycleSummaryItemType = 'reminder_log' | 'reminder_nudge' | 'notification_event';

/** Stable ids for the four sections, in render order. */
export type CycleSummarySectionId =
  'training_due' | 'training_upcoming' | 'team_compliance' | 'organization_updates';

/**
 * One reminder row, already resolved to a single recipient. The same source row
 * yields two items when a stage targets both audiences — one `worker` copy for
 * the learner and one `escalation` copy per manager — which is what lets the
 * learner's item land in section 1/2 while the manager's lands in section 3.
 */
export interface ReminderSummaryItem {
  /** Source row id, recorded on the email's `CycleSummaryItem`. */
  id: string;
  itemType: 'reminder_log' | 'reminder_nudge';
  /** Set for ladder rows (`reminder_log`). */
  stage?: ReminderStage;
  /** Set for nudge rows (`reminder_nudge`). */
  kind?: ReminderNudgeKind;
  /** Whether this copy is the learner's own or is about someone they oversee. */
  recipientRole: 'worker' | 'escalation';
  courseTitle: string;
  dueAt: Date | null;
  /** Display name of the learner the item is about. */
  workerName: string;
  /** Whole days past `dueAt` at compose time; 0 when not overdue. */
  daysOverdue: number;
  /** Remaining quiz attempts — `WORKER_RETAKE` only. */
  attemptsRemaining?: number;
}

/** A single line in a training section. */
export interface CycleSummaryTrainingItem {
  courseTitle: string;
  /** Short status line, e.g. "3 days overdue (due March 1, 2026)". */
  detail: string;
  dueAt: Date | null;
  daysOverdue: number;
}

/** Section 3 is grouped by the learner the items are about. */
export interface CycleSummaryWorkerGroup {
  workerName: string;
  items: CycleSummaryTrainingItem[];
}

export type CycleSummarySection =
  | {
      id: 'training_due' | 'training_upcoming';
      title: string;
      items: CycleSummaryTrainingItem[];
    }
  | { id: 'team_compliance'; title: string; groups: CycleSummaryWorkerGroup[] }
  | { id: 'organization_updates'; title: string; sections: DigestSection[] };

export const SECTION_TITLES: Record<CycleSummarySectionId, string> = {
  training_due: 'Your training — overdue and due today',
  training_upcoming: 'Your training — upcoming',
  team_compliance: 'Team & compliance',
  organization_updates: 'Organization updates',
};

/** Render a deadline in the same friendly form the reminder templates use, in UTC. */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Which section an item belongs to.
 *
 * Escalation copies always describe someone else's training, so they go to
 * section 3 whatever their stage. For the learner's own copies the split is read
 * off the ladder itself: a stage whose offset is at or past the deadline
 * (`offsetDays >= 0`) is due-or-overdue, anything earlier is upcoming.
 *
 * `WORKER_RETAKE` carries no stage offset — it fires after a failed attempt, so
 * the work is already outstanding rather than upcoming, and it is grouped with
 * the due items.
 */
export function sectionForReminderItem(
  item: ReminderSummaryItem,
): Exclude<CycleSummarySectionId, 'organization_updates'> {
  if (item.recipientRole === 'escalation') return 'team_compliance';
  if (item.itemType === 'reminder_nudge') return 'training_due';
  if (!item.stage) return 'training_due';
  return REMINDER_STAGE_DEFAULTS[item.stage].offsetDays >= 0 ? 'training_due' : 'training_upcoming';
}

/** The status line under a course title. */
function detailFor(item: ReminderSummaryItem): string {
  if (item.kind === 'WORKER_RETAKE') {
    // `ReminderNudge.attemptsRemaining` is pinned when the nudge is claimed, so
    // the count is normally available. It is still nullable — a row claimed
    // before the cutover migration has none — and copy that promises an exact
    // number must never guess one, so those degrade to the countless line.
    if (item.attemptsRemaining === undefined) return 'Quiz retake available';
    const remaining = item.attemptsRemaining;
    return `Quiz retake available — ${remaining} attempt${remaining === 1 ? '' : 's'} remaining`;
  }
  if (item.kind === 'ADMIN_REASSIGN') {
    return 'All quiz attempts used — needs a retake assignment';
  }
  if (item.daysOverdue > 0) {
    const overdue = `${item.daysOverdue} day${item.daysOverdue === 1 ? '' : 's'} overdue`;
    return item.dueAt ? `${overdue} (due ${formatDate(item.dueAt)})` : overdue;
  }
  if (item.stage === 'DAY_OF_DEADLINE') return 'Due today';
  return item.dueAt ? `Due ${formatDate(item.dueAt)}` : 'Action needed';
}

/**
 * Most-urgent-first: furthest past the deadline, then soonest deadline, then a
 * deterministic tie-break so two runs over the same data render identically.
 */
function byUrgency(a: ReminderSummaryItem, b: ReminderSummaryItem): number {
  if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
  const aDue = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  if (a.courseTitle !== b.courseTitle) return a.courseTitle < b.courseTitle ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toTrainingItem(item: ReminderSummaryItem): CycleSummaryTrainingItem {
  return {
    courseTitle: item.courseTitle,
    detail: detailFor(item),
    dueAt: item.dueAt,
    daysOverdue: item.daysOverdue,
  };
}

export interface CycleSummarySectionInput {
  /** This recipient's reminder items, in any order. */
  reminders: ReminderSummaryItem[];
  /** The notification digest's sections for this recipient, already built. */
  organizationUpdates: DigestSection[];
}

/**
 * Build the ordered, non-empty sections of one recipient's summary. Returns an
 * empty array when the recipient has nothing at all — the caller treats that as
 * "send no email".
 */
export function buildCycleSummarySections(input: CycleSummarySectionInput): CycleSummarySection[] {
  const due: ReminderSummaryItem[] = [];
  const upcoming: ReminderSummaryItem[] = [];
  const team: ReminderSummaryItem[] = [];

  for (const item of input.reminders) {
    switch (sectionForReminderItem(item)) {
      case 'training_due':
        due.push(item);
        break;
      case 'training_upcoming':
        upcoming.push(item);
        break;
      case 'team_compliance':
        team.push(item);
        break;
    }
  }

  const sections: CycleSummarySection[] = [];

  if (due.length > 0) {
    sections.push({
      id: 'training_due',
      title: SECTION_TITLES.training_due,
      items: due.sort(byUrgency).map(toTrainingItem),
    });
  }

  if (upcoming.length > 0) {
    sections.push({
      id: 'training_upcoming',
      title: SECTION_TITLES.training_upcoming,
      items: upcoming.sort(byUrgency).map(toTrainingItem),
    });
  }

  if (team.length > 0) {
    sections.push({
      id: 'team_compliance',
      title: SECTION_TITLES.team_compliance,
      groups: groupByWorker(team),
    });
  }

  if (input.organizationUpdates.length > 0) {
    sections.push({
      id: 'organization_updates',
      title: SECTION_TITLES.organization_updates,
      sections: input.organizationUpdates,
    });
  }

  return sections;
}

/** Group section 3 by the learner each item is about, most-urgent group first. */
function groupByWorker(items: ReminderSummaryItem[]): CycleSummaryWorkerGroup[] {
  const byWorker = new Map<string, ReminderSummaryItem[]>();
  for (const item of items) {
    const bucket = byWorker.get(item.workerName);
    if (bucket) bucket.push(item);
    else byWorker.set(item.workerName, [item]);
  }

  return [...byWorker.entries()]
    .map(([workerName, workerItems]) => ({ workerName, items: workerItems.sort(byUrgency) }))
    .sort((a, b) => {
      const ranked = byUrgency(a.items[0], b.items[0]);
      return ranked !== 0 ? ranked : a.workerName < b.workerName ? -1 : 1;
    })
    .map((group) => ({ workerName: group.workerName, items: group.items.map(toTrainingItem) }));
}

/** Total line count of a summary — drives the "nothing to send" check and logging. */
export function countSectionItems(sections: CycleSummarySection[]): number {
  let total = 0;
  for (const section of sections) {
    if (section.id === 'team_compliance') {
      for (const group of section.groups) total += group.items.length;
    } else if (section.id === 'organization_updates') {
      for (const digestSection of section.sections) {
        for (const group of digestSection.groups) total += group.items.length;
      }
    } else {
      total += section.items.length;
    }
  }
  return total;
}
