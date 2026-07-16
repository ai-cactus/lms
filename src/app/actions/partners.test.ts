/**
 * Unit tests for src/app/actions/partners.ts — submitPartnerApplication()
 *
 * Mirrors the mocking approach used for the sibling `demo.ts` action-shaped
 * flow (captcha → zod validation → email send), matching the conventions
 * already established in organization.test.ts / certificate.test.ts
 * (`next/headers` stubbed to an empty Headers()) and captcha.test.ts (the
 * captcha module itself is fully unit-tested there, so here it is mocked at
 * the boundary rather than re-exercised).
 *
 * Coverage:
 *   - Invalid input (missing name / malformed email) → { success: false },
 *     no email attempted.
 *   - Captcha failure → { success: false, error mentioning captcha }, no
 *     email attempted.
 *   - Happy path → { success: true } with a message, using the caller-
 *     supplied data.
 *   - Email-send failure → { success: false } WITHOUT throwing (the action
 *     must not propagate the email helper's own error).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerifyCaptcha, mockSendPartnerApplicationEmail } = vi.hoisted(() => ({
  mockVerifyCaptcha: vi.fn(),
  mockSendPartnerApplicationEmail: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/captcha', () => ({ verifyCaptcha: mockVerifyCaptcha }));
vi.mock('@/lib/email', () => ({ sendPartnerApplicationEmail: mockSendPartnerApplicationEmail }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { submitPartnerApplication } from './partners';

function makeFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: captcha passes, so validation/email behavior can be tested in
  // isolation unless a test overrides this.
  mockVerifyCaptcha.mockResolvedValue(true);
});

describe('submitPartnerApplication', () => {
  it('rejects a missing name and never attempts to send an email', async () => {
    const formData = makeFormData({ email: 'jordan@example.com' });

    const result = await submitPartnerApplication(null, formData);

    expect(result.success).toBe(false);
    expect(mockSendPartnerApplicationEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed email and never attempts to send an email', async () => {
    const formData = makeFormData({ name: 'Jordan Rivera', email: 'not-an-email' });

    const result = await submitPartnerApplication(null, formData);

    expect(result.success).toBe(false);
    expect(mockSendPartnerApplicationEmail).not.toHaveBeenCalled();
  });

  it('fails closed when captcha verification fails, without attempting validation or email', async () => {
    mockVerifyCaptcha.mockResolvedValue(false);
    const formData = makeFormData({
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
      captchaToken: 'bad-token',
    });

    const result = await submitPartnerApplication(null, formData);

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/captcha/i),
      }),
    );
    expect(mockSendPartnerApplicationEmail).not.toHaveBeenCalled();
  });

  it('returns success with a message on the happy path, forwarding parsed data to the email helper', async () => {
    mockSendPartnerApplicationEmail.mockResolvedValue({ success: true, messageId: 'mid-1' });
    const formData = makeFormData({
      name: 'Jordan Rivera',
      email: 'jordan@example.com',
      company: 'Rivera Compliance Advisory',
      network: '6–15',
      message: 'We work with several behavioral-health clinics.',
    });

    const result = await submitPartnerApplication(null, formData);

    expect(result).toEqual(expect.objectContaining({ success: true, message: expect.any(String) }));
    expect(mockSendPartnerApplicationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jordan Rivera',
        email: 'jordan@example.com',
        company: 'Rivera Compliance Advisory',
        network: '6–15',
        message: 'We work with several behavioral-health clinics.',
      }),
    );
  });

  it('succeeds with only the required fields — company/network/message are optional', async () => {
    mockSendPartnerApplicationEmail.mockResolvedValue({ success: true, messageId: 'mid-2' });
    const formData = makeFormData({ name: 'Jordan Rivera', email: 'jordan@example.com' });

    const result = await submitPartnerApplication(null, formData);

    expect(result.success).toBe(true);
    expect(mockSendPartnerApplicationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jordan Rivera', email: 'jordan@example.com' }),
    );
  });

  it('returns a failure without throwing when the email helper reports failure', async () => {
    mockSendPartnerApplicationEmail.mockResolvedValue({
      success: false,
      error: 'Misconfigured email environment variables.',
    });
    const formData = makeFormData({ name: 'Jordan Rivera', email: 'jordan@example.com' });

    await expect(submitPartnerApplication(null, formData)).resolves.toEqual(
      expect.objectContaining({ success: false }),
    );
  });
});
