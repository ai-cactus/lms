/**
 * Unit tests for the delivery-tracking layer in src/lib/email.ts (F-021).
 *
 * Every non-reminder send is routed through the `sendMailTracked` transport
 * wrapper, which persists an EmailMessage row on BOTH outcomes:
 *   - transport succeeds → EmailMessage 'sent' (with sentAt)
 *   - transport throws    → EmailMessage 'failed' (attempts=1, lastError)
 *
 * Reminder-ladder sends are tracked by dispatch.ts instead and are covered by
 * dispatch.test.ts / sweep.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock references ──────────────────────────────────────────────────

const { mockSendMail, prismaMock } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  prismaMock: { emailMessage: { create: vi.fn() } },
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { sendInviteEmail } from './email';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.emailMessage.create.mockResolvedValue({ id: 'em-1' });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('email delivery tracking (F-021)', () => {
  it("records an EmailMessage 'sent' when the transport succeeds", async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-1' });

    const result = await sendInviteEmail('user@test.com', 'https://app/invite', 'Acme', 'worker');

    expect(result).toEqual(expect.objectContaining({ success: true, messageId: 'mid-1' }));
    expect(prismaMock.emailMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toEmail: 'user@test.com',
        kind: 'invite',
        status: 'sent',
        sentAt: expect.any(Date),
      }),
    });
  });

  it("records an EmailMessage 'failed' (attempts=1, lastError) when the transport throws", async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP down'));

    const result = await sendInviteEmail('user@test.com', 'https://app/invite', 'Acme', 'worker');

    // The sender preserves its existing structured-error contract.
    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(prismaMock.emailMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toEmail: 'user@test.com',
        kind: 'invite',
        status: 'failed',
        attempts: 1,
        lastError: 'SMTP down',
      }),
    });
  });

  it('never lets a tracking-write failure break the actual send', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-2' });
    prismaMock.emailMessage.create.mockRejectedValue(new Error('DB down'));

    const result = await sendInviteEmail('user@test.com', 'https://app/invite', 'Acme', 'worker');

    // Send still reported success even though the EmailMessage insert failed.
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });
});
