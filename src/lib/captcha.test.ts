/**
 * Regression tests for F-023 — verifyCaptcha (src/lib/captcha.ts).
 *
 * Coverage:
 *   - Inert by default: no HCAPTCHA_ENABLED (or not 'true') → returns true, NO fetch call.
 *   - Enabled + missing token → fails closed (false).
 *   - Enabled + siteverify success:true → true.
 *   - Enabled + siteverify success:false → false.
 *   - Enabled + network/parse error → fails closed (false).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { verifyCaptcha } from './captcha';

describe('verifyCaptcha (F-023)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('is inert when HCAPTCHA_ENABLED is unset — returns true and makes NO network call', async () => {
    delete process.env.HCAPTCHA_ENABLED;
    delete process.env.HCAPTCHA_SECRET_KEY;

    const result = await verifyCaptcha('some-token');

    expect(result).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is inert when HCAPTCHA_ENABLED is set to something other than "true" — returns true, no fetch', async () => {
    process.env.HCAPTCHA_ENABLED = 'false';
    process.env.HCAPTCHA_SECRET_KEY = 'secret';

    const result = await verifyCaptcha('some-token');

    expect(result).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is inert when enabled but no secret key is configured — returns true, no fetch', async () => {
    process.env.HCAPTCHA_ENABLED = 'true';
    delete process.env.HCAPTCHA_SECRET_KEY;

    const result = await verifyCaptcha('some-token');

    expect(result).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when enabled + secret configured but token is missing', async () => {
    process.env.HCAPTCHA_ENABLED = 'true';
    process.env.HCAPTCHA_SECRET_KEY = 'secret';

    const result = await verifyCaptcha(undefined);

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns true when enabled and siteverify responds with success:true', async () => {
    process.env.HCAPTCHA_ENABLED = 'true';
    process.env.HCAPTCHA_SECRET_KEY = 'secret';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await verifyCaptcha('valid-token', '1.2.3.4');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hcaptcha.com/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns false when enabled and siteverify responds with success:false', async () => {
    process.env.HCAPTCHA_ENABLED = 'true';
    process.env.HCAPTCHA_SECRET_KEY = 'secret';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });

    const result = await verifyCaptcha('bad-token');

    expect(result).toBe(false);
  });

  it('fails closed when siteverify returns a non-2xx response', async () => {
    process.env.HCAPTCHA_ENABLED = 'true';
    process.env.HCAPTCHA_SECRET_KEY = 'secret';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await verifyCaptcha('some-token');

    expect(result).toBe(false);
  });

  it('fails closed when fetch throws a network error', async () => {
    process.env.HCAPTCHA_ENABLED = 'true';
    process.env.HCAPTCHA_SECRET_KEY = 'secret';
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await verifyCaptcha('some-token');

    expect(result).toBe(false);
  });

  it('fails closed when the response body fails to parse as JSON', async () => {
    process.env.HCAPTCHA_ENABLED = 'true';
    process.env.HCAPTCHA_SECRET_KEY = 'secret';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('unexpected token');
      },
    });

    const result = await verifyCaptcha('some-token');

    expect(result).toBe(false);
  });
});
