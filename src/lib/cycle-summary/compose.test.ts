/**
 * Unit tests for runCycleSummary / periodKeyForDay — the unified daily summary.
 *
 * Covers: the org-scan UNION (a reminder-only organization is not skipped);
 * one email per recipient; a manager who is also a learner receiving one email
 * carrying both their own and their team's sections; empty organization sends
 * nothing but still closes its run; weekly-org notification gating on Monday vs
 * any other day; realtime orgs never getting the notification section; the
 * nudge `summarizedAt: null` gather contract; claim-race P2002; the
 * skipDuplicates race guard; dry-run performing zero writes; leftover rows still
 * being stamped so nothing is re-gathered forever; fan-out to N escalation
 * admins and N role-routed recipients; one recipient accumulating multiple
 * rows into a single email; a row resolving to zero recipients still being
 * stamped (and NOT stamped in dry-run).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  MockPrismaKnownRequestError,
  mockResolveEscalationRecipients,
  mockResolveRoleRecipients,
  mockIsChannelEnabled,
} = vi.hoisted(() => {
  const prismaMock = {
    notificationEvent: { groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    organization: { findMany: vi.fn() },
    facility: { findMany: vi.fn() },
    cycleSummaryRun: { create: vi.fn(), update: vi.fn() },
    reminderLog: { findMany: vi.fn(), updateMany: vi.fn() },
    reminderNudge: { findMany: vi.fn(), updateMany: vi.fn() },
    emailMessage: { create: vi.fn(), update: vi.fn() },
    cycleSummaryItem: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };

  // Same technique as src/lib/notifications/digest.test.ts: a fake class that
  // passes `instanceof Prisma.PrismaClientKnownRequestError` because both this
  // file and compose.ts import the same mocked module.
  class MockPrismaKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'PrismaClientKnownRequestError';
    }
  }

  return {
    prismaMock,
    MockPrismaKnownRequestError,
    mockResolveEscalationRecipients: vi.fn(),
    mockResolveRoleRecipients: vi.fn(),
    mockIsChannelEnabled: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/generated/prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: MockPrismaKnownRequestError },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/reminders/recipients', () => ({
  resolveEscalationRecipients: mockResolveEscalationRecipients,
}));
vi.mock('@/lib/notifications/recipients', () => ({
  resolveRoleRecipients: mockResolveRoleRecipients,
}));
vi.mock('@/lib/notifications/category-preferences', () => ({
  isNotificationChannelEnabled: mockIsChannelEnabled,
}));

import { periodKeyForDay, runCycleSummary, CYCLE_SUMMARY_EMAIL_KIND } from './compose';

/** A Monday. Weekly-cadence organizations are due on Mondays (UTC). */
const MONDAY = new Date('2026-09-21T13:00:00.000Z');
/** A Wednesday — weekly organizations are NOT due. */
const WEDNESDAY = new Date('2026-09-23T13:00:00.000Z');

const ORG = { id: 'org-1', name: 'Acme Care', notificationDigestFrequency: 'daily' as const };

function enrollmentContext(
  overrides: {
    organizationUserId?: string;
    email?: string;
    fullName?: string | null;
    dueAt?: Date | null;
    title?: string;
  } = {},
) {
  return {
    dueAt: overrides.dueAt === undefined ? new Date('2026-09-25T00:00:00.000Z') : overrides.dueAt,
    organizationUserId: overrides.organizationUserId ?? 'worker-ou-1',
    course: { title: overrides.title ?? 'Bloodborne Pathogens' },
    organizationUser: {
      organizationId: ORG.id,
      user: {
        email: overrides.email ?? 'worker@acme.com',
        fullName: overrides.fullName === undefined ? 'Dana Learner' : overrides.fullName,
      },
      facilities: [{ facility: { timezone: 'America/New_York' } }],
    },
  };
}

function reminderLogRow(
  overrides: {
    id?: string;
    stage?: string;
    enrollment?: ReturnType<typeof enrollmentContext>;
  } = {},
) {
  return {
    id: overrides.id ?? 'log-1',
    stage: overrides.stage ?? 'FRIENDLY_REMINDER',
    enrollment: overrides.enrollment ?? enrollmentContext(),
  };
}

function pendingEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'event-1',
    facilityId: null,
    type: 'STAFF_ADDED',
    actorUserId: null,
    payload: {
      title: 'New staff member added',
      message: 'Jane joined as Nurse.',
      routing: { roles: ['hr'], fallbackToOwner: true },
    },
    createdAt: new Date('2026-09-23T10:00:00.000Z'),
    ...overrides,
  };
}

/** Run the callback against the same mock client, like a real interactive tx. */
function passthroughTransaction(fn: (tx: typeof prismaMock) => unknown) {
  return fn(prismaMock);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.notificationEvent.groupBy.mockResolvedValue([]);
  prismaMock.notificationEvent.findMany.mockResolvedValue([]);
  prismaMock.notificationEvent.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.organization.findMany.mockResolvedValue([]);
  prismaMock.facility.findMany.mockResolvedValue([]);
  prismaMock.cycleSummaryRun.create.mockResolvedValue({ id: 'run-1' });
  prismaMock.cycleSummaryRun.update.mockResolvedValue({});
  prismaMock.reminderLog.findMany.mockResolvedValue([]);
  prismaMock.reminderLog.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.reminderNudge.findMany.mockResolvedValue([]);
  prismaMock.reminderNudge.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.emailMessage.create.mockResolvedValue({ id: 'email-1' });
  prismaMock.emailMessage.update.mockResolvedValue({});
  prismaMock.cycleSummaryItem.createMany.mockResolvedValue({ count: 0 });
  prismaMock.$transaction.mockImplementation(passthroughTransaction);
  mockResolveEscalationRecipients.mockResolvedValue({
    organizationUserIds: ['mgr-ou-1'],
    emails: [{ email: 'manager@acme.com', name: 'Morgan Manager' }],
    members: [
      { organizationUserId: 'mgr-ou-1', email: 'manager@acme.com', name: 'Morgan Manager' },
    ],
  });
  mockResolveRoleRecipients.mockResolvedValue({
    organizationUserIds: ['hr-ou-1'],
    emails: [
      { organizationUserId: 'hr-ou-1', userId: 'hr-user-1', email: 'hr@acme.com', name: 'Hayley' },
    ],
    usedFallback: false,
    missingRoles: [],
  });
  mockIsChannelEnabled.mockResolvedValue(true);
});

describe('periodKeyForDay', () => {
  it('is always daily, keyed on the UTC date', () => {
    expect(periodKeyForDay(new Date('2026-09-23T23:30:00.000Z'))).toBe('daily:2026-09-23');
  });
});

describe('runCycleSummary — organization scan union', () => {
  it('includes an organization with reminders but no pending notification events', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([]);
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(prismaMock.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [ORG.id] } } }),
    );
    expect(summary.organizationsScanned).toBe(1);
    expect(summary.emailsSent).toBe(1);
  });

  it('includes an organization with pending events but no reminders', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(summary.organizationsScanned).toBe(1);
    expect(summary.emailsSent).toBe(1);
  });

  it('counts an organization on both sides of the union only once', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(summary.organizationsScanned).toBe(1);
  });

  it('returns a zeroed summary and touches no run table when nothing is outstanding', async () => {
    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(summary).toMatchObject({ organizationsScanned: 0, emailsSent: 0, summariesSent: 0 });
    expect(prismaMock.organization.findMany).not.toHaveBeenCalled();
    expect(prismaMock.cycleSummaryRun.create).not.toHaveBeenCalled();
  });
});

describe('runCycleSummary — gather contract', () => {
  it('only gathers un-summarized reminder rows, and only email-channel ladder rows', async () => {
    await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(prismaMock.reminderLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { summarizedAt: null, channels: { has: 'email' } },
      }),
    );
    // A nudge is an upsert row with no channel column: a re-nudge resets
    // summarizedAt to null (PR 2, dispatch side) and this query must pick the
    // row up again on the strength of that alone.
    expect(prismaMock.reminderNudge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { summarizedAt: null } }),
    );
  });
});

describe('runCycleSummary — per-recipient grouping', () => {
  it('sends one email per recipient, each carrying only their own rows', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([
      reminderLogRow({ id: 'log-a', enrollment: enrollmentContext() }),
      reminderLogRow({
        id: 'log-b',
        enrollment: enrollmentContext({
          organizationUserId: 'worker-ou-2',
          email: 'second@acme.com',
          fullName: 'Sam Second',
        }),
      }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = sendEmail.mock.calls.map(([m]) => m.to).sort();
    expect(recipients).toEqual(['second@acme.com', 'worker@acme.com']);
    for (const [message] of sendEmail.mock.calls) {
      expect(message.periodKey).toBe('daily:2026-09-23');
      expect(message.organizationName).toBe('Acme Care');
    }
  });

  it('gives a manager who is also a learner ONE email holding both section families', async () => {
    // The learner's manager is the learner themselves — the same membership is
    // both the worker audience and the escalation audience.
    mockResolveEscalationRecipients.mockResolvedValue({
      organizationUserIds: ['worker-ou-1'],
      emails: [{ email: 'worker@acme.com', name: 'Dana Learner' }],
      members: [
        { organizationUserId: 'worker-ou-1', email: 'worker@acme.com', name: 'Dana Learner' },
      ],
    });
    prismaMock.reminderLog.findMany.mockResolvedValue([
      reminderLogRow({ id: 'log-a', stage: 'GRACE_SOFT_ESCALATION' }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [message] = sendEmail.mock.calls[0];
    expect(message.sections.map((s: { id: string }) => s.id)).toEqual([
      'training_due',
      'team_compliance',
    ]);
  });

  it('records the email with the summary kind, the org and the recipient name', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(prismaMock.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          toEmail: 'worker@acme.com',
          toName: 'Dana Learner',
          kind: CYCLE_SUMMARY_EMAIL_KIND,
          organizationId: ORG.id,
          status: 'queued',
        },
      }),
    );
  });

  it('writes the covered rows with skipDuplicates so a retried insert is absorbed', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow({ id: 'log-a' })]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(prismaMock.cycleSummaryItem.createMany).toHaveBeenCalledWith({
      data: [{ emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-a' }],
      skipDuplicates: true,
    });
  });

  it('stamps only the recipient rows that are still un-summarized', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow({ id: 'log-a' })]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(prismaMock.reminderLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['log-a'] }, summarizedAt: null },
      data: { summarizedAt: WEDNESDAY },
    });
  });

  it('excludes a recipient from a summary of their own action', async () => {
    mockResolveRoleRecipients.mockResolvedValue({
      organizationUserIds: ['hr-ou-1'],
      emails: [
        {
          organizationUserId: 'hr-ou-1',
          userId: 'hr-user-1',
          email: 'hr@acme.com',
          name: 'Hayley',
        },
      ],
      usedFallback: false,
      missingRoles: [],
    });
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([
      pendingEvent({ actorUserId: 'hr-user-1' }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(sendEmail).not.toHaveBeenCalled();
    // …but the event is still dispatched, so it is never re-gathered.
    expect(prismaMock.notificationEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1'] }, status: 'pending' },
      data: { status: 'dispatched', dispatchedAt: WEDNESDAY, digestRunId: 'run-1' },
    });
  });
});

describe('runCycleSummary — recipient fan-out', () => {
  it('sends a team-section copy to every one of N escalation admins, not just the first', async () => {
    mockResolveEscalationRecipients.mockResolvedValue({
      organizationUserIds: ['mgr-ou-1', 'mgr-ou-2'],
      emails: [
        { email: 'manager@acme.com', name: 'Morgan Manager' },
        { email: 'second-admin@acme.com', name: 'Sasha Second' },
      ],
      members: [
        { organizationUserId: 'mgr-ou-1', email: 'manager@acme.com', name: 'Morgan Manager' },
        { organizationUserId: 'mgr-ou-2', email: 'second-admin@acme.com', name: 'Sasha Second' },
      ],
    });
    prismaMock.reminderLog.findMany.mockResolvedValue([
      reminderLogRow({ id: 'log-a', stage: 'HARD_ESCALATION' }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    // Both admins each get their own email — the worker themselves gets none,
    // since HARD_ESCALATION's audience is escalation-only.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = sendEmail.mock.calls.map(([m]) => m.to).sort();
    expect(recipients).toEqual(['manager@acme.com', 'second-admin@acme.com']);
    for (const [message] of sendEmail.mock.calls) {
      expect(message.sections.map((s: { id: string }) => s.id)).toEqual(['team_compliance']);
    }
  });

  it('resolves escalation for a learner only once even when they have several outstanding rows', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([
      reminderLogRow({ id: 'log-a', stage: 'HARD_ESCALATION' }),
      reminderLogRow({ id: 'log-b', stage: 'HARD_ESCALATION' }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(mockResolveEscalationRecipients).toHaveBeenCalledTimes(1);
  });

  it('sends every event to every one of N role-routed recipients', async () => {
    mockResolveRoleRecipients.mockResolvedValue({
      organizationUserIds: ['hr-ou-1', 'owner-ou-1'],
      emails: [
        {
          organizationUserId: 'hr-ou-1',
          userId: 'hr-user-1',
          email: 'hr@acme.com',
          name: 'Hayley',
        },
        {
          organizationUserId: 'owner-ou-1',
          userId: 'owner-user-1',
          email: 'owner@acme.com',
          name: 'Olga Owner',
        },
      ],
      usedFallback: false,
      missingRoles: [],
    });
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = sendEmail.mock.calls.map(([m]) => m.to).sort();
    expect(recipients).toEqual(['hr@acme.com', 'owner@acme.com']);
  });

  it('gives one recipient with several rows a single email holding all of them', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([
      reminderLogRow({
        id: 'log-a',
        stage: 'DAY_OF_DEADLINE',
        enrollment: enrollmentContext({ title: 'Course A' }),
      }),
      reminderLogRow({
        id: 'log-b',
        stage: 'FRIENDLY_REMINDER',
        enrollment: enrollmentContext({ title: 'Course B' }),
      }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [message] = sendEmail.mock.calls[0];
    expect(message.itemCount).toBe(2);
    const due = message.sections.find((s: { id: string }) => s.id === 'training_due');
    const upcoming = message.sections.find((s: { id: string }) => s.id === 'training_upcoming');
    expect(due.items.map((i: { courseTitle: string }) => i.courseTitle)).toEqual(['Course A']);
    expect(upcoming.items.map((i: { courseTitle: string }) => i.courseTitle)).toEqual(['Course B']);
  });
});

describe('runCycleSummary — leftover rows with zero resolved recipients', () => {
  it('stamps a reminder row whose only audience is escalation but nobody resolved', async () => {
    mockResolveEscalationRecipients.mockResolvedValue({
      organizationUserIds: [],
      emails: [],
      members: [],
    });
    prismaMock.reminderLog.findMany.mockResolvedValue([
      reminderLogRow({ id: 'log-orphan', stage: 'HARD_ESCALATION' }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    // Nobody to mail — but the source row must still be stamped, or it would be
    // re-gathered by every future run forever.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prismaMock.emailMessage.create).not.toHaveBeenCalled();
    expect(prismaMock.reminderLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['log-orphan'] }, summarizedAt: null },
      data: { summarizedAt: WEDNESDAY },
    });
    expect(summary.remindersSummarized).toBe(1);
  });

  it('does NOT stamp a zero-recipient row during a dry run', async () => {
    mockResolveEscalationRecipients.mockResolvedValue({
      organizationUserIds: [],
      emails: [],
      members: [],
    });
    prismaMock.reminderLog.findMany.mockResolvedValue([
      reminderLogRow({ id: 'log-orphan', stage: 'HARD_ESCALATION' }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    await runCycleSummary({ now: WEDNESDAY, dryRun: true });

    expect(prismaMock.reminderLog.updateMany).not.toHaveBeenCalled();
  });
});

describe('runCycleSummary — notification cadence gating', () => {
  it('includes the notification section for a weekly organization on a Monday', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);
    prismaMock.organization.findMany.mockResolvedValue([
      { ...ORG, notificationDigestFrequency: 'weekly' },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: MONDAY, dryRun: false, sendEmail });

    expect(prismaMock.notificationEvent.findMany).toHaveBeenCalled();
    const [message] = sendEmail.mock.calls[0];
    expect(message.sections.map((s: { id: string }) => s.id)).toEqual(['organization_updates']);
  });

  it('omits the notification section for a weekly organization on any other day', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);
    prismaMock.organization.findMany.mockResolvedValue([
      { ...ORG, notificationDigestFrequency: 'weekly' },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(prismaMock.notificationEvent.findMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still emails a weekly organization off-Monday when it has reminder content', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([
      { ...ORG, notificationDigestFrequency: 'weekly' },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    const [message] = sendEmail.mock.calls[0];
    expect(message.sections.map((s: { id: string }) => s.id)).toEqual(['training_upcoming']);
  });

  it('gives a realtime organization no notification section, because it has no pending events', async () => {
    // A realtime org dispatches digest-tier events at emit time, so its pending
    // queue is empty and the section is omitted for want of content.
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([
      { ...ORG, notificationDigestFrequency: 'realtime' },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: MONDAY, dryRun: false, sendEmail });

    const [message] = sendEmail.mock.calls[0];
    expect(message.sections.map((s: { id: string }) => s.id)).toEqual(['training_upcoming']);
  });

  it('still flushes events a realtime organization left pending from an earlier cadence', async () => {
    // Switching daily → realtime strands whatever was already queued. Treating
    // realtime as "due" (what `isDue` does) drains them instead of leaving them
    // pending forever.
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);
    prismaMock.organization.findMany.mockResolvedValue([
      { ...ORG, notificationDigestFrequency: 'realtime' },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummary({ now: MONDAY, dryRun: false, sendEmail });

    const [message] = sendEmail.mock.calls[0];
    expect(message.sections.map((s: { id: string }) => s.id)).toEqual(['organization_updates']);
    expect(prismaMock.notificationEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1'] }, status: 'pending' },
      data: { status: 'dispatched', dispatchedAt: MONDAY, digestRunId: 'run-1' },
    });
  });
});

describe('runCycleSummary — empty organization', () => {
  it('closes the run and sends nothing when the gated content leaves it empty', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(prismaMock.emailMessage.create).not.toHaveBeenCalled();
    expect(prismaMock.cycleSummaryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'sent', eventCount: 0, sentAt: WEDNESDAY },
    });
    expect(summary.emailsSent).toBe(0);
  });
});

describe('runCycleSummary — claim race', () => {
  it('skips an organization whose period was already claimed (P2002)', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    prismaMock.cycleSummaryRun.create.mockRejectedValueOnce(
      new MockPrismaKnownRequestError('Unique constraint failed', 'P2002'),
    );
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(summary.skipped).toBe(1);
    expect(summary.errors).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prismaMock.emailMessage.create).not.toHaveBeenCalled();
    expect(prismaMock.reminderLog.updateMany).not.toHaveBeenCalled();
  });

  it('counts a non-P2002 claim failure as an error and leaves rows un-summarized', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    prismaMock.cycleSummaryRun.create.mockRejectedValueOnce(new Error('DB connection lost'));

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(summary.errors).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(prismaMock.reminderLog.updateMany).not.toHaveBeenCalled();
  });

  it('marks the run failed when composing throws after the claim', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    prismaMock.$transaction.mockRejectedValueOnce(new Error('tx exploded'));

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(summary.errors).toBe(1);
    expect(prismaMock.cycleSummaryRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'failed' },
    });
  });
});

describe('runCycleSummary — delivery failure', () => {
  it('records the failure on the EmailMessage but does not re-summarize the rows', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow({ id: 'log-a' })]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: false, error: new Error('SMTP down') });

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(summary.emailsSent).toBe(0);
    expect(summary.errors).toBe(1);
    expect(prismaMock.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: { status: 'failed', attempts: { increment: 1 }, lastError: 'SMTP down' },
    });
    expect(prismaMock.reminderLog.updateMany).toHaveBeenCalled();
  });

  it('marks the EmailMessage sent on success', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);

    await runCycleSummary({ now: WEDNESDAY, dryRun: false });

    expect(prismaMock.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: expect.objectContaining({ status: 'sent' }),
    });
  });
});

describe('runCycleSummary — dry run', () => {
  it('performs zero writes and reports what it would have sent', async () => {
    prismaMock.reminderLog.findMany.mockResolvedValue([reminderLogRow()]);
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: ORG.id }]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);
    prismaMock.organization.findMany.mockResolvedValue([ORG]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: true, sendEmail });

    expect(summary.wouldSend).toBe(2);
    expect(summary.emailsSent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prismaMock.cycleSummaryRun.create).not.toHaveBeenCalled();
    expect(prismaMock.cycleSummaryRun.update).not.toHaveBeenCalled();
    expect(prismaMock.emailMessage.create).not.toHaveBeenCalled();
    expect(prismaMock.cycleSummaryItem.createMany).not.toHaveBeenCalled();
    expect(prismaMock.reminderLog.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.reminderNudge.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.notificationEvent.updateMany).not.toHaveBeenCalled();
  });
});

describe('runCycleSummary — isolation', () => {
  it('one failing organization does not stop the others', async () => {
    const otherOrg = { ...ORG, id: 'org-2', name: 'Beta Health' };
    prismaMock.reminderLog.findMany.mockResolvedValue([
      reminderLogRow({ id: 'log-a' }),
      reminderLogRow({
        id: 'log-b',
        enrollment: {
          ...enrollmentContext({ organizationUserId: 'worker-ou-9', email: 'nine@beta.com' }),
          organizationUser: {
            ...enrollmentContext().organizationUser,
            organizationId: otherOrg.id,
            user: { email: 'nine@beta.com', fullName: 'Nina Nine' },
          },
        },
      }),
    ]);
    prismaMock.organization.findMany.mockResolvedValue([ORG, otherOrg]);
    prismaMock.cycleSummaryRun.create
      .mockRejectedValueOnce(new Error('claim exploded'))
      .mockResolvedValueOnce({ id: 'run-2' });
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummary({ now: WEDNESDAY, dryRun: false, sendEmail });

    expect(summary.errors).toBe(1);
    expect(summary.emailsSent).toBe(1);
    expect(sendEmail.mock.calls[0][0].organizationName).toBe('Beta Health');
  });
});
