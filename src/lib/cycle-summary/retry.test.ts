/**
 * Unit tests for src/lib/cycle-summary/retry.ts
 *
 * The cutover collapses N reminder emails into one, so the per-message delivery
 * proof the reminder sweep used to give has to survive here. These pin the three
 * properties that make that true: a failed summary is rebuilt from the rows it
 * recorded and re-sent to its own recipient only; a source row that has since
 * vanished degrades that one line instead of the whole email; and the attempt
 * cap plus the `failed`-only selection keep anyone from being mailed twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    emailMessage: { findMany: vi.fn(), update: vi.fn() },
    cycleSummaryItem: { findMany: vi.fn() },
    reminderLog: { findMany: vi.fn() },
    reminderNudge: { findMany: vi.fn() },
    enrollment: { findMany: vi.fn() },
    notificationEvent: { findMany: vi.fn() },
    organization: { findMany: vi.fn() },
    facility: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { runCycleSummaryRetry } from './retry';
import { CYCLE_SUMMARY_EMAIL_KIND } from './compose';

const NOW = new Date('2026-09-24T13:00:00.000Z');
/** Older than the 1h backoff floor, so the row is eligible. */
const LAST_ATTEMPT = new Date('2026-09-23T14:00:00.000Z');

const WORKER_EMAIL = 'worker@acme.com';
const MANAGER_EMAIL = 'manager@acme.com';

function failedMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'email-1',
    toEmail: WORKER_EMAIL,
    toName: 'Dana Learner',
    organizationId: 'org-1',
    attempts: 1,
    maxAttempts: 3,
    createdAt: new Date('2026-09-23T13:00:00.000Z'),
    updatedAt: LAST_ATTEMPT,
    ...overrides,
  };
}

function enrollmentContext(
  overrides: {
    dueAt?: Date | null;
    title?: string;
    id?: string;
    status?: 'in_progress' | 'locked' | 'completed' | 'attested';
    archivedAt?: Date | null;
  } = {},
) {
  return {
    id: overrides.id ?? 'enrollment-1',
    status: overrides.status ?? 'in_progress',
    dueAt: overrides.dueAt === undefined ? new Date('2026-09-20T00:00:00.000Z') : overrides.dueAt,
    organizationUserId: 'worker-ou-1',
    course: {
      title: overrides.title ?? 'Bloodborne Pathogens',
      archivedAt: overrides.archivedAt ?? null,
    },
    organizationUser: {
      organizationId: 'org-1',
      user: { email: WORKER_EMAIL, fullName: 'Dana Learner' },
      facilities: [{ facility: { timezone: 'America/New_York' } }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.emailMessage.findMany.mockResolvedValue([]);
  prismaMock.emailMessage.update.mockResolvedValue({});
  prismaMock.cycleSummaryItem.findMany.mockResolvedValue([]);
  prismaMock.reminderLog.findMany.mockResolvedValue([]);
  prismaMock.reminderNudge.findMany.mockResolvedValue([]);
  prismaMock.enrollment.findMany.mockResolvedValue([]); // superseded lookup: no retakes
  prismaMock.notificationEvent.findMany.mockResolvedValue([]);
  // Two readers share this mock: the deleted-org lookup (filters on a non-null
  // deletedAt) must find nothing, the live-org name lookup finds the org.
  prismaMock.organization.findMany.mockImplementation(
    async ({ where }: { where: { deletedAt?: unknown } }) =>
      where.deletedAt && typeof where.deletedAt === 'object'
        ? []
        : [{ id: 'org-1', name: 'Acme Care' }],
  );
  prismaMock.facility.findMany.mockResolvedValue([]);
});

describe('runCycleSummaryRetry — candidate selection', () => {
  it('returns a zeroed summary and loads nothing when no summary has failed', async () => {
    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false });

    expect(summary).toMatchObject({ candidates: 0, resent: 0, failed: 0 });
    expect(prismaMock.cycleSummaryItem.findMany).not.toHaveBeenCalled();
  });

  it('selects only failed summary emails past the backoff floor', async () => {
    await runCycleSummaryRetry({ now: NOW, dryRun: false });

    expect(prismaMock.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: CYCLE_SUMMARY_EMAIL_KIND,
          // `failed` only. A row already flipped to `sent` is invisible here,
          // which is what stops a recipient being mailed the same summary twice.
          status: 'failed',
          updatedAt: { lt: new Date(NOW.getTime() - 60 * 60 * 1000) },
        }),
      }),
    );
  });

  it('leaves a soft-deleted organization failed summary out of the selection, keeping org-less rows', async () => {
    prismaMock.organization.findMany.mockImplementation(
      async ({ where }: { where: { deletedAt?: unknown } }) =>
        where.deletedAt && typeof where.deletedAt === 'object' ? [{ id: 'org-deleted' }] : [],
    );

    await runCycleSummaryRetry({ now: NOW, dryRun: false });

    const where = prismaMock.emailMessage.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { organizationId: null },
      { organizationId: { notIn: ['org-deleted'] } },
    ]);
  });

  it('adds no organization predicate when nothing is soft-deleted', async () => {
    await runCycleSummaryRetry({ now: NOW, dryRun: false });

    expect(prismaMock.emailMessage.findMany.mock.calls[0][0].where).not.toHaveProperty('OR');
  });

  it('counts a message past its attempt cap as exhausted and never re-sends it', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([
      failedMessage({ attempts: 3, maxAttempts: 3 }),
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    expect(summary).toMatchObject({ candidates: 0, exhausted: 1, resent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prismaMock.emailMessage.update).not.toHaveBeenCalled();
  });
});

describe('runCycleSummaryRetry — re-checks the enrolment before re-sending (BUG-45)', () => {
  beforeEach(() => {
    prismaMock.emailMessage.findMany.mockResolvedValue([failedMessage()]);
  });

  it('cancels an email whose only line is about a finished enrolment, sending nothing', async () => {
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-1' },
    ]);
    prismaMock.reminderLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        stage: 'GRACE_SOFT_ESCALATION',
        enrollment: enrollmentContext({ status: 'attested' }),
      },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(prismaMock.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: { status: 'cancelled' },
    });
    expect(summary).toMatchObject({ cancelled: 1, itemsDropped: 1, unreconstructable: 0 });
  });

  it('drops a superseded line and still re-sends the owed one', async () => {
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-locked' },
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-owed' },
    ]);
    prismaMock.reminderLog.findMany.mockResolvedValue([
      {
        id: 'log-locked',
        stage: 'HARD_ESCALATION',
        enrollment: enrollmentContext({ id: 'locked-1', status: 'locked', title: 'Old' }),
      },
      { id: 'log-owed', stage: 'GRACE_SOFT_ESCALATION', enrollment: enrollmentContext() },
    ]);
    prismaMock.enrollment.findMany.mockResolvedValue([{ retakeOf: 'locked-1' }]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sendEmail.mock.calls[0][0].sections)).not.toContain('"Old"');
    expect(summary).toMatchObject({ resent: 1, itemsDropped: 1, cancelled: 0 });
  });

  it('writes nothing under dryRun', async () => {
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-1' },
    ]);
    prismaMock.reminderLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        stage: 'GRACE_SOFT_ESCALATION',
        enrollment: enrollmentContext({ archivedAt: new Date('2026-09-22T00:00:00.000Z') }),
      },
    ]);

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: true });

    expect(prismaMock.emailMessage.update).not.toHaveBeenCalled();
    expect(summary.cancelled).toBe(1);
  });
});

describe('runCycleSummaryRetry — rebuild and re-send', () => {
  beforeEach(() => {
    prismaMock.emailMessage.findMany.mockResolvedValue([failedMessage()]);
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-1' },
    ]);
    prismaMock.reminderLog.findMany.mockResolvedValue([
      { id: 'log-1', stage: 'GRACE_SOFT_ESCALATION', enrollment: enrollmentContext() },
    ]);
  });

  it('resolves the organization name through the live-organization filter', async () => {
    await runCycleSummaryRetry({
      now: NOW,
      dryRun: false,
      sendEmail: vi.fn().mockResolvedValue({ ok: true }),
    });

    expect(prismaMock.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['org-1'] }, deletedAt: null } }),
    );
  });

  it('rebuilds the email from its recorded items and marks it sent', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    expect(summary).toMatchObject({ candidates: 1, resent: 1, failed: 0, itemsUnavailable: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const [message] = sendEmail.mock.calls[0];
    expect(message.to).toBe(WORKER_EMAIL);
    expect(message.toName).toBe('Dana Learner');
    expect(message.organizationName).toBe('Acme Care');
    // The period isn't stored on the message — the run that composed it created
    // the row, so its creation day is its period.
    expect(message.periodKey).toBe('daily:2026-09-23');
    expect(message.sections[0].items[0].courseTitle).toBe('Bloodborne Pathogens');

    expect(prismaMock.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: { status: 'sent', sentAt: expect.any(Date) },
    });
  });

  it('files a row addressed to someone other than the learner under Team & compliance', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([
      failedMessage({ toEmail: MANAGER_EMAIL, toName: 'Mo Manager' }),
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    const [message] = sendEmail.mock.calls[0];
    expect(message.sections[0].id).toBe('team_compliance');
    expect(message.sections[0].groups[0].workerName).toBe('Dana Learner');
  });

  it('burns one attempt and keeps the row failed when the re-send fails again', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: false, error: new Error('SMTP down') });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    expect(summary).toMatchObject({ resent: 0, failed: 1 });
    expect(prismaMock.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: { status: 'failed', attempts: { increment: 1 }, lastError: 'SMTP down' },
    });
  });

  it('treats a throwing transport as a failed attempt rather than aborting the pass', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('connection reset'));

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    expect(summary).toMatchObject({ failed: 1, errors: 0 });
    expect(prismaMock.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: expect.objectContaining({ status: 'failed', lastError: 'connection reset' }),
    });
  });

  it('performs zero writes under dryRun', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: true, sendEmail });

    expect(summary).toMatchObject({ candidates: 1, wouldResend: 1, resent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(prismaMock.emailMessage.update).not.toHaveBeenCalled();
  });
});

describe('runCycleSummaryRetry — recipient who is their own escalation target (BUG-21)', () => {
  // A worker_and_escalation row (e.g. GRACE_SOFT_ESCALATION) for a learner whose
  // resolved escalation recipient is themselves (no manager set, falls back to
  // "every admin", and this learner IS an admin) lands in compose.ts's bucket
  // TWICE — once as the 'worker' copy, once as the 'escalation' copy. The item
  // key carries the role, so both copies are recorded and both come back.
  it('rebuilds both the worker copy and the escalation copy the original send had', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([failedMessage()]); // toEmail: WORKER_EMAIL
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      {
        emailMessageId: 'email-1',
        itemType: 'reminder_log',
        itemId: 'log-1',
        recipientRole: 'worker',
      },
      {
        emailMessageId: 'email-1',
        itemType: 'reminder_log',
        itemId: 'log-1',
        recipientRole: 'escalation',
      },
    ]);
    prismaMock.reminderLog.findMany.mockResolvedValue([
      { id: 'log-1', stage: 'GRACE_SOFT_ESCALATION', enrollment: enrollmentContext() },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    const [message] = sendEmail.mock.calls[0];
    expect(message.sections.map((s: { id: string }) => s.id)).toEqual([
      'training_due',
      'team_compliance',
    ]);
  });

  it('still infers the role from the address for a row recorded before the column existed', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([
      failedMessage({ toEmail: MANAGER_EMAIL, toName: 'Morgan Manager' }),
    ]);
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-1', recipientRole: '' },
    ]);
    prismaMock.reminderLog.findMany.mockResolvedValue([
      { id: 'log-1', stage: 'GRACE_SOFT_ESCALATION', enrollment: enrollmentContext() },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    const [message] = sendEmail.mock.calls[0];
    expect(message.sections.map((s: { id: string }) => s.id)).toEqual(['team_compliance']);
  });
});

describe('runCycleSummaryRetry — degradation', () => {
  it('drops an item whose source row is gone and still sends the rest', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([failedMessage()]);
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-1' },
      // Its enrollment was deleted, so the log row no longer exists.
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-gone' },
      { emailMessageId: 'email-1', itemType: 'notification_event', itemId: 'event-gone' },
    ]);
    prismaMock.reminderLog.findMany.mockResolvedValue([
      { id: 'log-1', stage: 'GRACE_SOFT_ESCALATION', enrollment: enrollmentContext() },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    expect(summary).toMatchObject({ resent: 1, itemsUnavailable: 2, unreconstructable: 0 });
    const [message] = sendEmail.mock.calls[0];
    expect(message.sections).toHaveLength(1);
    expect(message.itemCount).toBe(1);
  });

  it('gives up on an email whose every item is gone, consuming an attempt', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([failedMessage()]);
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-gone' },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    expect(summary).toMatchObject({ unreconstructable: 1, resent: 0, itemsUnavailable: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
    // Consumes an attempt so the cap retires it, instead of re-examining a row
    // that can never improve on every future run.
    expect(prismaMock.emailMessage.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: expect.objectContaining({ status: 'failed', attempts: { increment: 1 } }),
    });
  });

  it('restates a retake nudge with the attempt count pinned on its row', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([failedMessage()]);
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_nudge', itemId: 'nudge-1' },
    ]);
    prismaMock.reminderNudge.findMany.mockResolvedValue([
      {
        id: 'nudge-1',
        kind: 'WORKER_RETAKE',
        attemptsRemaining: 2,
        enrollment: enrollmentContext({ dueAt: null }),
      },
    ]);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });

    await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    const [message] = sendEmail.mock.calls[0];
    expect(message.sections[0].items[0].detail).toBe(
      'Quiz retake available — 2 attempts remaining',
    );
  });

  it('isolates one recipient failure from the next recipient re-send', async () => {
    prismaMock.emailMessage.findMany.mockResolvedValue([
      failedMessage({ id: 'email-1' }),
      failedMessage({ id: 'email-2', toEmail: MANAGER_EMAIL, toName: 'Mo Manager' }),
    ]);
    prismaMock.cycleSummaryItem.findMany.mockResolvedValue([
      { emailMessageId: 'email-1', itemType: 'reminder_log', itemId: 'log-1' },
      { emailMessageId: 'email-2', itemType: 'reminder_log', itemId: 'log-1' },
    ]);
    prismaMock.reminderLog.findMany.mockResolvedValue([
      { id: 'log-1', stage: 'GRACE_SOFT_ESCALATION', enrollment: enrollmentContext() },
    ]);
    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: new Error('mailbox full') })
      .mockResolvedValueOnce({ ok: true });

    const summary = await runCycleSummaryRetry({ now: NOW, dryRun: false, sendEmail });

    // The same source row legitimately sits in two recipients' emails; retrying
    // per MESSAGE is what keeps that from re-mailing the one already served.
    expect(summary).toMatchObject({ candidates: 2, resent: 1, failed: 1 });
    expect(sendEmail.mock.calls.map(([m]) => m.to)).toEqual([WORKER_EMAIL, MANAGER_EMAIL]);
  });
});
