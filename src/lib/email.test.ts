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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { sendInviteEmail, sendPartnerApplicationEmail } from './email';

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

/**
 * Unit tests for sendPartnerApplicationEmail (partners feature). Mocked at
 * the same transporter boundary as the rest of this file — no real mail is
 * sent. Focused on the contract the /partners application form relies on:
 * inbox precedence, reply-to wiring, subject formatting, and HTML-escaping
 * of every applicant-supplied field.
 */
describe('sendPartnerApplicationEmail', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers PARTNER_INBOX over SMTP_USER/ZOHO_MAIL_USER when all are configured', async () => {
    process.env.PARTNER_INBOX = 'partners@theraptly.com';
    process.env.SMTP_USER = 'admin@theraptly.com';
    process.env.ZOHO_MAIL_USER = 'legacy@theraptly.com';
    mockSendMail.mockResolvedValue({ messageId: 'mid-p1' });

    const result = await sendPartnerApplicationEmail({
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
    });

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(mockSendMail.mock.calls[0][0].to).toBe('partners@theraptly.com');
  });

  it('falls back to SMTP_USER when PARTNER_INBOX is unset', async () => {
    delete process.env.PARTNER_INBOX;
    process.env.SMTP_USER = 'admin@theraptly.com';
    delete process.env.ZOHO_MAIL_USER;
    mockSendMail.mockResolvedValue({ messageId: 'mid-p2' });

    await sendPartnerApplicationEmail({ name: 'Jordan Rivera', email: 'jordan@example.com' });

    expect(mockSendMail.mock.calls[0][0].to).toBe('admin@theraptly.com');
  });

  it('sets replyTo to the applicant email and formats the subject with the applicant name', async () => {
    delete process.env.PARTNER_INBOX;
    process.env.SMTP_USER = 'admin@theraptly.com';
    mockSendMail.mockResolvedValue({ messageId: 'mid-p3' });

    await sendPartnerApplicationEmail({ name: 'Jordan Rivera', email: 'jordan@example.com' });

    const call = mockSendMail.mock.calls[0][0];
    expect(call.replyTo).toBe('jordan@example.com');
    expect(call.subject).toBe('New partner application — Jordan Rivera');
  });

  it('escapes HTML-significant characters in every field before interpolating into the body', async () => {
    process.env.PARTNER_INBOX = 'partners@theraptly.com';
    mockSendMail.mockResolvedValue({ messageId: 'mid-p4' });

    await sendPartnerApplicationEmail({
      name: '<b>Jordan</b> & Co',
      email: 'jordan@example.com',
      company: 'A & B <Consulting>',
      network: '6–15',
      message: '<script>alert(1)</script> & more',
    });

    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).not.toContain('<b>Jordan</b>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;b&gt;Jordan&lt;/b&gt; &amp; Co');
    expect(html).toContain('A &amp; B &lt;Consulting&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more');
  });

  it('returns a failure without throwing (and never calls the transport) when no inbox is configured', async () => {
    delete process.env.PARTNER_INBOX;
    delete process.env.SMTP_USER;
    delete process.env.ZOHO_MAIL_USER;

    const result = await sendPartnerApplicationEmail({
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
    });

    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('reports failure without throwing when the transport rejects', async () => {
    process.env.PARTNER_INBOX = 'partners@theraptly.com';
    mockSendMail.mockRejectedValue(new Error('SMTP down'));

    const result = await sendPartnerApplicationEmail({
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
    });

    expect(result).toEqual(expect.objectContaining({ success: false }));
  });
});
