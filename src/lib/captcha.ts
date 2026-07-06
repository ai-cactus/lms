import { logger } from '@/lib/logger';

// hCaptcha server-side verification endpoint.
// Docs: https://docs.hcaptcha.com/#verify-the-user-response-server-side
const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

/**
 * Verifies an hCaptcha response token against the hCaptcha siteverify API.
 *
 * The feature is INERT by default: unless `HCAPTCHA_ENABLED === 'true'` AND a
 * secret key is configured, this returns `true` and performs no network call —
 * so wiring it into a flow is a no-op until ops explicitly enable it.
 *
 * When enabled it fails CLOSED: a missing token, a non-2xx response, a network
 * error, or `success: false` all resolve to `false`.
 *
 * @param token    The `h-captcha-response` token produced by the client widget.
 * @param remoteIp Optional client IP, forwarded to hCaptcha for scoring accuracy.
 */
export async function verifyCaptcha(
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  // Inert unless explicitly enabled with a secret configured.
  if (process.env.HCAPTCHA_ENABLED !== 'true' || !process.env.HCAPTCHA_SECRET_KEY) {
    return true;
  }

  // Enabled but no token supplied — fail closed.
  if (!token) {
    logger.warn({ msg: '[captcha] Missing captcha token on protected request' });
    return false;
  }

  try {
    const params = new URLSearchParams();
    params.set('secret', process.env.HCAPTCHA_SECRET_KEY);
    params.set('response', token);
    if (remoteIp) {
      params.set('remoteip', remoteIp);
    }

    const res = await fetch(HCAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      logger.error({ msg: '[captcha] siteverify returned non-2xx', status: res.status });
      return false;
    }

    const data = (await res.json()) as SiteverifyResponse;

    if (data.success !== true) {
      logger.warn({ msg: '[captcha] Verification failed', errorCodes: data['error-codes'] });
      return false;
    }

    return true;
  } catch (err) {
    // Network / parse failure while enabled — fail closed rather than let bots through.
    logger.error({ msg: '[captcha] siteverify request error', err });
    return false;
  }
}
