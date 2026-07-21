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

import { sendInviteEmail, sendPartnerApplicationEmail, sendMfaOtpEmail } from './email';
import { OTP_EXPIRY_MINUTES } from './mfa';

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
 * QA ISSUE 5 regression: sendInviteEmail() previously interpolated the raw DB
 * role slug straight into the email body ("...join their team as a
 * behavioral_health_technician.", "...as a hr." — also a grammar miss). It now
 * converts the slug to the same human-readable label the in-app UI uses via
 * getRoleDisplayName(), and phrases it as "as: <Label>" to sidestep the a/an
 * article problem across role names.
 */
describe('sendInviteEmail — role label rendering (QA ISSUE 5)', () => {
  it('renders a multi-word role slug as its human-readable label, not the raw slug', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-3' });

    await sendInviteEmail(
      'user@test.com',
      'https://app/invite',
      'Acme',
      'behavioral_health_technician',
    );

    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).not.toContain('behavioral_health_technician');
    expect(html).toContain('Behavioral Health Technician');
  });

  it('renders the "as: <Label>" phrasing rather than the old "as a <role>" grammar', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-4' });

    await sendInviteEmail('user@test.com', 'https://app/invite', 'Acme', 'hr');

    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain('as: <strong>HR</strong>');
    expect(html).not.toContain('as a <strong>hr</strong>');
  });

  it('falls back to the raw value for an unrecognised role slug rather than throwing', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-5' });

    const result = await sendInviteEmail(
      'user@test.com',
      'https://app/invite',
      'Acme',
      'some_future_role',
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain('some_future_role');
  });
});

/**
 * Unit tests for sendPartnerApplicationEmail (partners feature). Mocked at
 * the same transporter boundary as the rest of this file — no real mail is
 * sent. Focused on the contract the /partners application form relies on:
 * inbox precedence, reply-to wiring, subject formatting, and HTML-escaping
 * of every applicant-supplied field.
 */
/**
 * OTP expiry copy-drift regression (see mfa.test.ts): the template used to
 * hardcode "15 minutes" while mfa.ts enforced a 10-minute window. It now
 * interpolates OTP_EXPIRY_MINUTES so the copy can never silently drift from
 * the actual enforced expiry again.
 */
describe('sendMfaOtpEmail — expiry copy is single-sourced from OTP_EXPIRY_MINUTES', () => {
  it('embeds the current OTP_EXPIRY_MINUTES value in the email body', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-otp' });

    await sendMfaOtpEmail('user@test.com', '123456');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining(`Code expires in ${OTP_EXPIRY_MINUTES} minutes.`),
      }),
    );
    // Regression pin: the old hardcoded value must never reappear.
    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).not.toMatch(/15 minutes/);
  });

  it('embeds the OTP code in the email body', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-otp-2' });

    await sendMfaOtpEmail('user@test.com', '654321');

    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain('654321');
  });
});

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
