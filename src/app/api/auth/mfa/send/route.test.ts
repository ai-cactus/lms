/**
 * Tests for POST /api/auth/mfa/send.
 *
 * Issue 4: a rate-limited (or otherwise failed) sendLoginMfaCode() used to be
 * masked as {success:true}, leaving the user staring at an OTP form waiting
 * for a code that would never arrive. The fix propagates the failure as a 429
 * with the underlying error message. The anti-enumeration behavior for an
 * invalid/missing challenge (always {success:true}, never revealing whether
 * the challenge exists) must be preserved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSendLoginMfaCode,
  mockPeekMfaChallenge,
  mockCheckRateLimitOnly,
  mockRecordRateLimitAttempt,
} = vi.hoisted(() => ({
  mockSendLoginMfaCode: vi.fn(),
  mockPeekMfaChallenge: vi.fn(),
  mockCheckRateLimitOnly: vi.fn(),
  mockRecordRateLimitAttempt: vi.fn(),
}));

vi.mock('@/app/actions/mfa', () => ({ sendLoginMfaCode: mockSendLoginMfaCode }));
vi.mock('@/lib/mfa-challenge', () => ({ peekMfaChallenge: mockPeekMfaChallenge }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitOnly: mockCheckRateLimitOnly,
  recordRateLimitAttempt: mockRecordRateLimitAttempt,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from './route';

function makeRequest(body: Record<string, unknown>, ip = '1.2.3.4'): Request {
  return new Request('http://localhost/api/auth/mfa/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

const CHALLENGE_DATA = { userId: 'user-1', role: 'admin' as const, createdAt: Date.now() };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimitOnly.mockResolvedValue({ allowed: true, remaining: 5, resetInSeconds: 900 });
  mockPeekMfaChallenge.mockResolvedValue(CHALLENGE_DATA);
  mockSendLoginMfaCode.mockResolvedValue({ success: true });
  mockRecordRateLimitAttempt.mockResolvedValue(undefined);
});

describe('POST /api/auth/mfa/send — input validation', () => {
  it('400s when challenge is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockPeekMfaChallenge).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/send — IP rate limit', () => {
  it('429s with an error body and never peeks the challenge when the IP limiter denies', async () => {
    mockCheckRateLimitOnly.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 900 });

    const res = await POST(makeRequest({ challenge: 'a'.repeat(64) }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBeTruthy();
    expect(mockPeekMfaChallenge).not.toHaveBeenCalled();
    expect(mockSendLoginMfaCode).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/send — anti-enumeration', () => {
  it('returns {success:true} for an invalid/missing challenge, without calling sendLoginMfaCode', async () => {
    mockPeekMfaChallenge.mockResolvedValue(null);

    const res = await POST(makeRequest({ challenge: 'a'.repeat(64) }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockSendLoginMfaCode).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/send — Issue 4: propagate a per-user send failure instead of masking it', () => {
  it('429s with the underlying error when sendLoginMfaCode reports a rate-limit failure', async () => {
    mockSendLoginMfaCode.mockResolvedValue({
      success: false,
      error: 'Too many code requests. Please try again later.',
    });

    const res = await POST(makeRequest({ challenge: 'a'.repeat(64) }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body).toEqual({ error: 'Too many code requests. Please try again later.' });
    // The IP-level attempt must not be recorded when the send itself failed —
    // only a genuinely delivered code should count against the IP budget.
    expect(mockRecordRateLimitAttempt).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/send — happy path', () => {
  it('sends the code, records the IP attempt, and returns {success:true}', async () => {
    const res = await POST(makeRequest({ challenge: 'a'.repeat(64) }, '9.9.9.9'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mockSendLoginMfaCode).toHaveBeenCalledWith('user-1');
    expect(mockRecordRateLimitAttempt).toHaveBeenCalledWith('mfa-send-ip:9.9.9.9', 900);
  });
});
