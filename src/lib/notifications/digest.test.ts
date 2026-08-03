/**
 * Unit tests for runNotificationDigest / periodKeyFor — the batched (Tier 2)
 * digest worker.
 *
 * Covers: periodKey daily/weekly ISO-week boundaries; weekly digests skipped
 * off-Monday; claim-first P2002 idempotency; facility → type grouping;
 * per-recipient exclusion of their own authored events; dry-run performs zero
 * writes; a failed organization leaves its events pending and does not abort
 * the run for other organizations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, MockPrismaKnownRequestError, mockResolveRoleRecipients } = vi.hoisted(() => {
  const prismaMock = {
    notificationEvent: { groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    organization: { findMany: vi.fn() },
    facility: { findMany: vi.fn() },
    notificationDigestRun: { create: vi.fn(), update: vi.fn() },
  };

  // Same technique as src/lib/reminders/dispatch.test.ts: a fake class that
  // passes `instanceof Prisma.PrismaClientKnownRequestError` because both this
  // file and digest.ts import the same mocked module.
  class MockPrismaKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'PrismaClientKnownRequestError';
    }
  }

  return { prismaMock, MockPrismaKnownRequestError, mockResolveRoleRecipients: vi.fn() };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/generated/prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: MockPrismaKnownRequestError },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('./recipients', () => ({ resolveRoleRecipients: mockResolveRoleRecipients }));

import { runNotificationDigest, periodKeyFor, ORGANIZATION_WIDE_LABEL } from './digest';

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
    createdAt: new Date('2026-08-03T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.notificationEvent.groupBy.mockResolvedValue([]);
  prismaMock.notificationEvent.findMany.mockResolvedValue([]);
  prismaMock.notificationEvent.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.organization.findMany.mockResolvedValue([]);
  prismaMock.facility.findMany.mockResolvedValue([]);
  prismaMock.notificationDigestRun.create.mockResolvedValue({ id: 'run-1' });
  prismaMock.notificationDigestRun.update.mockResolvedValue({});
  mockResolveRoleRecipients.mockResolvedValue({
    userIds: ['hr-1'],
    emails: [{ userId: 'hr-1', email: 'hr-1@acme.com', name: null }],
    usedFallback: false,
    missingRoles: [],
  });
});

describe('periodKeyFor — daily', () => {
  it('produces daily:<UTC-date> from the now timestamp', () => {
    expect(periodKeyFor('daily', new Date('2026-08-03T10:00:00.000Z'))).toBe('daily:2026-08-03');
  });

  it('uses the UTC date even when local time would roll to the next/previous day', () => {
    // 11:30pm UTC on Aug 3 — a US-local clock reading this at 6:30pm ET must
    // still key off the UTC date, per the single-UTC-cron design.
    expect(periodKeyFor('daily', new Date('2026-08-03T23:30:00.000Z'))).toBe('daily:2026-08-03');
  });
});

describe('periodKeyFor — weekly ISO week boundaries', () => {
  it('produces weekly:<ISO-year>-W<week> for a mid-week date', () => {
    // 2026-08-03 is a Monday in ISO week 32 of 2026.
    expect(periodKeyFor('weekly', new Date('2026-08-03T13:00:00.000Z'))).toBe('weekly:2026-W32');
  });

  it('assigns Dec 31 2024 (a Tuesday) to ISO week 1 of 2025 — the ISO year can differ from the calendar year', () => {
    expect(periodKeyFor('weekly', new Date('2024-12-31T00:00:00.000Z'))).toBe('weekly:2025-W01');
  });

  it('assigns Jan 1 2023 (a Sunday) to ISO week 52 of 2022', () => {
    expect(periodKeyFor('weekly', new Date('2023-01-01T00:00:00.000Z'))).toBe('weekly:2022-W52');
  });
});

describe('runNotificationDigest — nothing pending', () => {
  it('returns a zeroed summary and touches no organization/digest-run tables', async () => {
    const summary = await runNotificationDigest({ now: new Date(), dryRun: false });

    expect(summary).toEqual({
      organizationsScanned: 0,
      organizationsDue: 0,
      digestsSent: 0,
      emailsSent: 0,
      eventsDispatched: 0,
      skipped: 0,
      wouldSend: 0,
      errors: 0,
    });
    expect(prismaMock.organization.findMany).not.toHaveBeenCalled();
  });
});

describe('runNotificationDigest — weekly cadence gating', () => {
  it('skips a weekly org entirely (not even claimed) when now is not a Monday UTC', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'weekly' },
    ]);

    // 2026-08-04 is a Tuesday.
    const summary = await runNotificationDigest({
      now: new Date('2026-08-04T13:00:00.000Z'),
      dryRun: false,
    });

    expect(summary.organizationsScanned).toBe(1);
    expect(summary.organizationsDue).toBe(0);
    expect(prismaMock.notificationDigestRun.create).not.toHaveBeenCalled();
  });

  it('processes a weekly org when now IS a Monday UTC', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'weekly' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);

    const summary = await runNotificationDigest({
      now: new Date('2026-08-03T13:00:00.000Z'), // Monday
      dryRun: false,
    });

    expect(summary.organizationsDue).toBe(1);
    expect(prismaMock.notificationDigestRun.create).toHaveBeenCalledOnce();
  });

  it('a daily org is due on every run regardless of weekday', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);

    const summary = await runNotificationDigest({
      now: new Date('2026-08-04T13:00:00.000Z'), // Tuesday
      dryRun: false,
    });

    expect(summary.organizationsDue).toBe(1);
  });
});

describe('runNotificationDigest — claim idempotency (P2002)', () => {
  it('skips the organization when the digest run for this period is already claimed', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationDigestRun.create.mockRejectedValueOnce(
      new MockPrismaKnownRequestError('Unique constraint failed', 'P2002'),
    );

    const summary = await runNotificationDigest({ now: new Date(), dryRun: false });

    expect(summary.skipped).toBe(1);
    expect(summary.digestsSent).toBe(0);
    expect(prismaMock.notificationEvent.findMany).not.toHaveBeenCalled();
  });

  it('a non-P2002 create error is NOT swallowed as a skip — it counts as a run error', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationDigestRun.create.mockRejectedValueOnce(new Error('DB connection lost'));

    const summary = await runNotificationDigest({ now: new Date(), dryRun: false });

    expect(summary.errors).toBe(1);
    expect(summary.skipped).toBe(0);
  });

  it('does not attempt to claim a run in dry-run mode', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);

    await runNotificationDigest({ now: new Date(), dryRun: true });

    expect(prismaMock.notificationDigestRun.create).not.toHaveBeenCalled();
  });
});

describe('runNotificationDigest — dry-run purity', () => {
  it('performs zero writes and reports intended sends via wouldSend', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent()]);

    const summary = await runNotificationDigest({ now: new Date(), dryRun: true });

    expect(summary.wouldSend).toBe(1);
    expect(summary.emailsSent).toBe(0);
    expect(prismaMock.notificationEvent.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.notificationDigestRun.update).not.toHaveBeenCalled();
    expect(prismaMock.notificationDigestRun.create).not.toHaveBeenCalled();
  });
});

describe('runNotificationDigest — sending, grouping, and dispatch bookkeeping', () => {
  it('sends one email per recipient, groups by facility → type, and marks events dispatched with the digestRunId', async () => {
    const event = pendingEvent({ facilityId: 'fac-1' });
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([event]);
    prismaMock.facility.findMany.mockResolvedValue([{ id: 'fac-1', name: 'Downtown Clinic' }]);

    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const summary = await runNotificationDigest({ now: new Date(), dryRun: false, sendEmail });

    expect(sendEmail).toHaveBeenCalledOnce();
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe('hr-1@acme.com');
    expect(message.sections).toEqual([
      {
        facilityName: 'Downtown Clinic',
        groups: [
          {
            type: 'STAFF_ADDED',
            label: 'Staff added',
            items: [
              {
                title: event.payload.title,
                message: event.payload.message,
                occurredAt: event.createdAt,
              },
            ],
          },
        ],
      },
    ]);

    expect(prismaMock.notificationEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1'] } },
      data: { status: 'dispatched', dispatchedAt: expect.any(Date), digestRunId: 'run-1' },
    });
    expect(prismaMock.notificationDigestRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'sent', eventCount: 1, sentAt: expect.any(Date) },
    });
    expect(summary.digestsSent).toBe(1);
    expect(summary.emailsSent).toBe(1);
    expect(summary.eventsDispatched).toBe(1);
  });

  it('groups events with no facilityId under the organization-wide bucket', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([pendingEvent({ facilityId: null })]);

    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    await runNotificationDigest({ now: new Date(), dryRun: false, sendEmail });

    const message = sendEmail.mock.calls[0][0];
    expect(message.sections[0].facilityName).toBe(ORGANIZATION_WIDE_LABEL);
    expect(prismaMock.facility.findMany).not.toHaveBeenCalled();
  });

  it('re-resolves recipients at send time by pinned routing, not by re-deriving from the actor', async () => {
    const event = pendingEvent({
      payload: {
        title: 'x',
        message: 'y',
        routing: { roles: ['clinical_director'], fallbackToOwner: true },
      },
    });
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([event]);
    mockResolveRoleRecipients.mockResolvedValue({
      userIds: ['cd-1'],
      emails: [{ userId: 'cd-1', email: 'cd-1@acme.com', name: null }],
      usedFallback: false,
      missingRoles: [],
    });

    await runNotificationDigest({
      now: new Date(),
      dryRun: false,
      sendEmail: vi.fn().mockResolvedValue({ ok: true }),
    });

    expect(mockResolveRoleRecipients).toHaveBeenCalledWith('org-1', ['clinical_director'], {
      fallbackToOwner: true,
    });
  });

  it('caches recipient resolution per distinct route within one digest pass', async () => {
    const eventA = pendingEvent({ id: 'event-a' });
    const eventB = pendingEvent({ id: 'event-b' });
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([eventA, eventB]);

    await runNotificationDigest({
      now: new Date(),
      dryRun: false,
      sendEmail: vi.fn().mockResolvedValue({ ok: true }),
    });

    expect(mockResolveRoleRecipients).toHaveBeenCalledTimes(1);
  });
});

describe('runNotificationDigest — per-recipient own-event exclusion', () => {
  it('excludes an event from a recipient digest when that recipient authored it themselves', async () => {
    const ownEvent = pendingEvent({ id: 'own-event', actorUserId: 'hr-1' });
    const othersEvent = pendingEvent({ id: 'others-event', actorUserId: 'someone-else' });
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([ownEvent, othersEvent]);

    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    await runNotificationDigest({ now: new Date(), dryRun: false, sendEmail });

    // hr-1 is the only recipient; they authored one of the two events, so their
    // digest must contain only the other one.
    expect(sendEmail).toHaveBeenCalledOnce();
    const message = sendEmail.mock.calls[0][0];
    expect(message.totalCount).toBe(1);
    expect(message.sections[0].groups[0].items).toHaveLength(1);
  });

  it('sends nobody a digest (but still dispatches the event) when every recipient authored every pending event', async () => {
    const ownEvent = pendingEvent({ actorUserId: 'hr-1' });
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([ownEvent]);

    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const summary = await runNotificationDigest({ now: new Date(), dryRun: false, sendEmail });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(summary.emailsSent).toBe(0);
    expect(prismaMock.notificationEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'dispatched' }) }),
    );
  });
});

describe('runNotificationDigest — org failure isolation', () => {
  it('leaves an org’s events pending, marks the run failed, and continues to other organizations', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([
      { organizationId: 'org-fail' },
      { organizationId: 'org-ok' },
    ]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-fail', name: 'Failing Co', notificationDigestFrequency: 'daily' },
      { id: 'org-ok', name: 'Fine Co', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationDigestRun.create
      .mockResolvedValueOnce({ id: 'run-fail' })
      .mockResolvedValueOnce({ id: 'run-ok' });
    prismaMock.notificationEvent.findMany
      .mockRejectedValueOnce(new Error('DB blew up mid-collection'))
      .mockResolvedValueOnce([pendingEvent()]);

    const summary = await runNotificationDigest({
      now: new Date(),
      dryRun: false,
      sendEmail: vi.fn().mockResolvedValue({ ok: true }),
    });

    expect(summary.errors).toBe(1);
    expect(summary.digestsSent).toBe(1); // org-ok still completed
    expect(prismaMock.notificationDigestRun.update).toHaveBeenCalledWith({
      where: { id: 'run-fail' },
      data: { status: 'failed' },
    });
    // The failed org's events are untouched — no updateMany with its ids, and
    // no 'sent' status ever written for run-fail.
    expect(prismaMock.notificationDigestRun.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-fail' },
        data: expect.objectContaining({ status: 'sent' }),
      }),
    );
  });

  it('marks an empty-events claimed run sent with eventCount 0 rather than leaving it dangling', async () => {
    prismaMock.notificationEvent.groupBy.mockResolvedValue([{ organizationId: 'org-1' }]);
    prismaMock.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Acme', notificationDigestFrequency: 'daily' },
    ]);
    prismaMock.notificationEvent.findMany.mockResolvedValue([]);

    await runNotificationDigest({ now: new Date(), dryRun: false });

    expect(prismaMock.notificationDigestRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'sent', eventCount: 0, sentAt: expect.any(Date) },
    });
  });
});
