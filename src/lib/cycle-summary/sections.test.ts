/**
 * Unit tests for src/lib/cycle-summary/sections.ts
 *
 * Covers: stage → section mapping for both audiences; empty sections omitted;
 * fixed section order; most-urgent-first ordering; section 3 grouped by the
 * learner it is about; a manager who is also a learner getting both their own
 * training sections and the team section; detail copy; item counting.
 */
import { describe, it, expect } from 'vitest';
import type { DigestSection } from '@/lib/notifications/digest';
import {
  buildCycleSummarySections,
  countSectionItems,
  sectionForReminderItem,
  SECTION_TITLES,
  type CycleSummarySection,
  type ReminderSummaryItem,
} from './sections';

function reminder(overrides: Partial<ReminderSummaryItem> = {}): ReminderSummaryItem {
  return {
    id: 'log-1',
    itemType: 'reminder_log',
    stage: 'FRIENDLY_REMINDER',
    recipientRole: 'worker',
    courseTitle: 'Bloodborne Pathogens',
    dueAt: new Date('2026-10-01T00:00:00.000Z'),
    workerName: 'Dana Learner',
    daysOverdue: 0,
    ...overrides,
  };
}

const ORG_UPDATES: DigestSection[] = [
  {
    facilityName: 'Organization-wide',
    groups: [
      {
        type: 'STAFF_ADDED',
        label: 'Staff added',
        items: [
          {
            title: 'New staff member added',
            message: 'Jane joined as Nurse.',
            occurredAt: new Date('2026-09-23T10:00:00.000Z'),
          },
        ],
      },
    ],
  },
];

function sectionIds(sections: CycleSummarySection[]): string[] {
  return sections.map((s) => s.id);
}

describe('sectionForReminderItem', () => {
  it('routes every escalation copy to the team section, whatever the stage', () => {
    expect(
      sectionForReminderItem(reminder({ stage: 'FRIENDLY_REMINDER', recipientRole: 'escalation' })),
    ).toBe('team_compliance');
    expect(
      sectionForReminderItem(reminder({ stage: 'HARD_ESCALATION', recipientRole: 'escalation' })),
    ).toBe('team_compliance');
  });

  it('routes pre-deadline worker stages to upcoming', () => {
    expect(sectionForReminderItem(reminder({ stage: 'FRIENDLY_REMINDER' }))).toBe(
      'training_upcoming',
    );
    expect(sectionForReminderItem(reminder({ stage: 'URGENT_REMINDER' }))).toBe(
      'training_upcoming',
    );
  });

  it('routes day-of and overdue worker stages to the due section', () => {
    expect(sectionForReminderItem(reminder({ stage: 'DAY_OF_DEADLINE' }))).toBe('training_due');
    expect(sectionForReminderItem(reminder({ stage: 'GRACE_SOFT_ESCALATION' }))).toBe(
      'training_due',
    );
  });

  it('treats a worker retake nudge as outstanding work, not upcoming', () => {
    expect(
      sectionForReminderItem(
        reminder({ itemType: 'reminder_nudge', stage: undefined, kind: 'WORKER_RETAKE' }),
      ),
    ).toBe('training_due');
  });

  it('routes an admin reassign nudge to the team section', () => {
    expect(
      sectionForReminderItem(
        reminder({
          itemType: 'reminder_nudge',
          stage: undefined,
          kind: 'ADMIN_REASSIGN',
          recipientRole: 'escalation',
        }),
      ),
    ).toBe('team_compliance');
  });
});

describe('buildCycleSummarySections — composition', () => {
  it('returns no sections at all when the recipient has nothing', () => {
    expect(buildCycleSummarySections({ reminders: [], organizationUpdates: [] })).toEqual([]);
  });

  it('omits empty sections and keeps the fixed order', () => {
    const sections = buildCycleSummarySections({
      reminders: [
        reminder({ id: 'a', stage: 'DAY_OF_DEADLINE' }),
        reminder({ id: 'b', stage: 'HARD_ESCALATION', recipientRole: 'escalation' }),
      ],
      organizationUpdates: ORG_UPDATES,
    });

    expect(sectionIds(sections)).toEqual([
      'training_due',
      'team_compliance',
      'organization_updates',
    ]);
  });

  it('renders all four sections in order when all are populated', () => {
    const sections = buildCycleSummarySections({
      reminders: [
        reminder({ id: 'a', stage: 'DAY_OF_DEADLINE' }),
        reminder({ id: 'b', stage: 'FRIENDLY_REMINDER' }),
        reminder({ id: 'c', stage: 'HARD_ESCALATION', recipientRole: 'escalation' }),
      ],
      organizationUpdates: ORG_UPDATES,
    });

    expect(sectionIds(sections)).toEqual([
      'training_due',
      'training_upcoming',
      'team_compliance',
      'organization_updates',
    ]);
    expect(sections.map((s) => s.title)).toEqual([
      SECTION_TITLES.training_due,
      SECTION_TITLES.training_upcoming,
      SECTION_TITLES.team_compliance,
      SECTION_TITLES.organization_updates,
    ]);
  });

  it('gives a manager who is also a learner BOTH their own training and the team section', () => {
    const sections = buildCycleSummarySections({
      reminders: [
        reminder({ id: 'own', stage: 'DAY_OF_DEADLINE', courseTitle: 'My Own Course' }),
        reminder({
          id: 'report',
          stage: 'HARD_ESCALATION',
          recipientRole: 'escalation',
          courseTitle: "Report's Course",
          workerName: 'Sam Report',
          daysOverdue: 7,
        }),
      ],
      organizationUpdates: [],
    });

    expect(sectionIds(sections)).toEqual(['training_due', 'team_compliance']);
    const due = sections[0];
    const team = sections[1];
    if (due.id !== 'training_due' || team.id !== 'team_compliance') throw new Error('bad shape');
    expect(due.items.map((i) => i.courseTitle)).toEqual(['My Own Course']);
    expect(team.groups.map((g) => g.workerName)).toEqual(['Sam Report']);
  });

  it('keeps both copies of one source row when the learner is their own escalation target', () => {
    const sections = buildCycleSummarySections({
      reminders: [
        reminder({ id: 'shared', stage: 'GRACE_SOFT_ESCALATION', daysOverdue: 3 }),
        reminder({
          id: 'shared',
          stage: 'GRACE_SOFT_ESCALATION',
          recipientRole: 'escalation',
          daysOverdue: 3,
        }),
      ],
      organizationUpdates: [],
    });

    expect(sectionIds(sections)).toEqual(['training_due', 'team_compliance']);
  });
});

describe('buildCycleSummarySections — ordering', () => {
  it('orders the due section most-overdue first', () => {
    const sections = buildCycleSummarySections({
      reminders: [
        reminder({ id: 'a', stage: 'DAY_OF_DEADLINE', courseTitle: 'Due today', daysOverdue: 0 }),
        reminder({
          id: 'b',
          stage: 'GRACE_SOFT_ESCALATION',
          courseTitle: 'Ten days late',
          daysOverdue: 10,
        }),
        reminder({
          id: 'c',
          stage: 'GRACE_SOFT_ESCALATION',
          courseTitle: 'Three days late',
          daysOverdue: 3,
        }),
      ],
      organizationUpdates: [],
    });

    const due = sections[0];
    if (due.id !== 'training_due') throw new Error('bad shape');
    expect(due.items.map((i) => i.courseTitle)).toEqual([
      'Ten days late',
      'Three days late',
      'Due today',
    ]);
  });

  it('orders the upcoming section by the soonest deadline', () => {
    const sections = buildCycleSummarySections({
      reminders: [
        reminder({
          id: 'a',
          courseTitle: 'Later',
          dueAt: new Date('2026-11-01T00:00:00.000Z'),
        }),
        reminder({
          id: 'b',
          courseTitle: 'Sooner',
          dueAt: new Date('2026-10-02T00:00:00.000Z'),
        }),
        reminder({ id: 'c', courseTitle: 'No deadline', dueAt: null }),
      ],
      organizationUpdates: [],
    });

    const upcoming = sections[0];
    if (upcoming.id !== 'training_upcoming') throw new Error('bad shape');
    expect(upcoming.items.map((i) => i.courseTitle)).toEqual(['Sooner', 'Later', 'No deadline']);
  });

  it('groups the team section by learner, most-urgent group first', () => {
    const sections = buildCycleSummarySections({
      reminders: [
        reminder({
          id: 'a',
          stage: 'GRACE_SOFT_ESCALATION',
          recipientRole: 'escalation',
          workerName: 'Alice',
          courseTitle: 'Course A',
          daysOverdue: 2,
        }),
        reminder({
          id: 'b',
          stage: 'HARD_ESCALATION',
          recipientRole: 'escalation',
          workerName: 'Bob',
          courseTitle: 'Course B',
          daysOverdue: 9,
        }),
        reminder({
          id: 'c',
          stage: 'HARD_ESCALATION',
          recipientRole: 'escalation',
          workerName: 'Alice',
          courseTitle: 'Course C',
          daysOverdue: 8,
        }),
      ],
      organizationUpdates: [],
    });

    const team = sections[0];
    if (team.id !== 'team_compliance') throw new Error('bad shape');
    expect(team.groups.map((g) => g.workerName)).toEqual(['Bob', 'Alice']);
    expect(team.groups[1].items.map((i) => i.courseTitle)).toEqual(['Course C', 'Course A']);
  });
});

describe('buildCycleSummarySections — detail copy', () => {
  function detailOf(item: ReminderSummaryItem): string {
    const sections = buildCycleSummarySections({
      reminders: [item],
      organizationUpdates: [],
    });
    const section = sections[0];
    if (section.id === 'team_compliance') return section.groups[0].items[0].detail;
    if (section.id === 'organization_updates') throw new Error('bad shape');
    return section.items[0].detail;
  }

  it('names the overdue day count and the original deadline', () => {
    expect(
      detailOf(
        reminder({
          stage: 'GRACE_SOFT_ESCALATION',
          daysOverdue: 3,
          dueAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ),
    ).toBe('3 days overdue (due March 1, 2026)');
  });

  it('singularises a one-day overdue item', () => {
    expect(
      detailOf(
        reminder({
          stage: 'GRACE_SOFT_ESCALATION',
          daysOverdue: 1,
          dueAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ),
    ).toBe('1 day overdue (due March 1, 2026)');
  });

  it('says "Due today" for the day-of stage', () => {
    expect(detailOf(reminder({ stage: 'DAY_OF_DEADLINE' }))).toBe('Due today');
  });

  it('names the deadline for an upcoming item', () => {
    expect(detailOf(reminder({ dueAt: new Date('2026-10-01T00:00:00.000Z') }))).toBe(
      'Due October 1, 2026',
    );
  });

  // The count comes from ReminderNudge.attemptsRemaining, pinned when the nudge
  // was claimed. It is nullable (rows claimed before the cutover have none), and
  // copy promising an exact number must never invent one.
  it('does not assert an attempt count when the nudge row has none', () => {
    expect(
      detailOf(reminder({ itemType: 'reminder_nudge', stage: undefined, kind: 'WORKER_RETAKE' })),
    ).toBe('Quiz retake available');
  });

  it('reports the remaining attempts the nudge row pinned', () => {
    expect(
      detailOf(
        reminder({
          itemType: 'reminder_nudge',
          stage: undefined,
          kind: 'WORKER_RETAKE',
          attemptsRemaining: 1,
        }),
      ),
    ).toBe('Quiz retake available — 1 attempt remaining');
  });

  it('pluralises a multi-attempt count, matching the standalone nudge email', () => {
    expect(
      detailOf(
        reminder({
          itemType: 'reminder_nudge',
          stage: undefined,
          kind: 'WORKER_RETAKE',
          attemptsRemaining: 2,
        }),
      ),
    ).toBe('Quiz retake available — 2 attempts remaining');
  });

  it('explains an exhausted-attempts escalation', () => {
    expect(
      detailOf(
        reminder({
          itemType: 'reminder_nudge',
          stage: undefined,
          kind: 'ADMIN_REASSIGN',
          recipientRole: 'escalation',
        }),
      ),
    ).toBe('All quiz attempts used — needs a retake assignment');
  });
});

describe('countSectionItems', () => {
  it('counts lines across all four section shapes', () => {
    const sections = buildCycleSummarySections({
      reminders: [
        reminder({ id: 'a', stage: 'DAY_OF_DEADLINE' }),
        reminder({ id: 'b', stage: 'FRIENDLY_REMINDER' }),
        reminder({ id: 'c', stage: 'HARD_ESCALATION', recipientRole: 'escalation' }),
      ],
      organizationUpdates: ORG_UPDATES,
    });

    expect(countSectionItems(sections)).toBe(4);
  });

  it('is zero for an empty summary', () => {
    expect(countSectionItems([])).toBe(0);
  });
});
