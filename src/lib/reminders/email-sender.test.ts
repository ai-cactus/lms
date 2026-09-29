/**
 * Unit tests for src/lib/reminders/email-sender.ts — the zone a deadline is
 * written in reaches the template (BUG-12.3). A deadline ends at 11:59 PM in the
 * learner's facility zone, so a template reading it in the server's zone would
 * print the day after the one that was picked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendDeadlineReminderEmail: vi.fn(),
  sendDeadlineOverdueWorkerEmail: vi.fn(),
  sendEscalationEmail: vi.fn(),
  sendPreDeadlineEscalationEmail: vi.fn(),
  sendRetakeReminderEmail: vi.fn(),
}));

vi.mock('@/lib/email', () => mocks);
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { reminderEmailSender } from './email-sender';
import type { ReminderEmailMessage } from './dispatch';

const DUE_AT = new Date('2026-10-01T09:59:00.000Z');

function message(overrides: Partial<ReminderEmailMessage> = {}): ReminderEmailMessage {
  return {
    to: 'worker@example.com',
    toName: 'Wren Worker',
    stage: 'FRIENDLY_REMINDER',
    recipientRole: 'worker',
    courseTitle: 'Infection Control',
    dueAt: DUE_AT,
    timeZone: 'Pacific/Honolulu',
    workerName: 'Wren Worker',
    daysOverdue: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const send of Object.values(mocks)) send.mockResolvedValue({ success: true });
});

describe('reminderEmailSender — deadline zone', () => {
  it('passes the learner zone to a worker deadline reminder', async () => {
    await reminderEmailSender(message());

    expect(mocks.sendDeadlineReminderEmail).toHaveBeenCalledWith(
      'worker@example.com',
      'Wren Worker',
      'Infection Control',
      DUE_AT,
      'friendly',
      'Pacific/Honolulu',
    );
  });

  it('passes the learner zone to the worker overdue email', async () => {
    await reminderEmailSender(message({ stage: 'GRACE_SOFT_ESCALATION', daysOverdue: 2 }));

    expect(mocks.sendDeadlineOverdueWorkerEmail).toHaveBeenCalledWith(
      'worker@example.com',
      'Wren Worker',
      'Infection Control',
      DUE_AT,
      2,
      'Pacific/Honolulu',
    );
  });

  it("passes the learner's zone, not the manager's, to an escalation", async () => {
    await reminderEmailSender(
      message({
        to: 'manager@example.com',
        toName: 'Morgan Manager',
        stage: 'HARD_ESCALATION',
        recipientRole: 'escalation',
        daysOverdue: 5,
      }),
    );

    expect(mocks.sendEscalationEmail).toHaveBeenCalledWith(
      'manager@example.com',
      'Morgan Manager',
      'Wren Worker',
      'Infection Control',
      DUE_AT,
      5,
      'Hard escalation',
      '/dashboard/status-tracker',
      'Pacific/Honolulu',
    );
  });

  it('passes the learner zone to the pre-deadline heads-up', async () => {
    await reminderEmailSender(
      message({
        to: 'manager@example.com',
        toName: 'Morgan Manager',
        stage: 'ADMIN_PRE_DEADLINE_REMINDER',
        recipientRole: 'escalation',
      }),
    );

    expect(mocks.sendPreDeadlineEscalationEmail).toHaveBeenCalledWith(
      'manager@example.com',
      'Morgan Manager',
      'Wren Worker',
      'Infection Control',
      DUE_AT,
      '/dashboard/status-tracker',
      'Pacific/Honolulu',
    );
  });

  it('falls back to America/New_York when a message carries no zone', async () => {
    await reminderEmailSender(message({ timeZone: undefined, stage: 'URGENT_REMINDER' }));

    expect(mocks.sendDeadlineReminderEmail).toHaveBeenCalledWith(
      'worker@example.com',
      'Wren Worker',
      'Infection Control',
      DUE_AT,
      'urgent',
      'America/New_York',
    );
  });
});
