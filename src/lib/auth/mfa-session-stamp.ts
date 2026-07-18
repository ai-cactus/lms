import 'server-only';

import { cookies } from 'next/headers';
import { decode, encode, type JWT } from 'next-auth/jwt';
import { sessionCookieName } from '@/lib/auth/session-cookies';
import { markSessionMfaVerified } from '@/lib/session-mfa';
import { logger } from '@/lib/logger';

export type MfaSessionStampResult =
  | { ok: true; cookieName: string; newToken: string; maxAge: number }
  | { ok: false; reason: 'no_secret' | 'no_cookie' | 'decode_failed' | 'no_session_id' };

/**
 * Mark the caller's active session as MFA-verified in BOTH stores that gate
 * step-up:
 *   1. Redis (`markSessionMfaVerified`) — the canonical per-session truth read
 *      by the jwt() callback on Node request paths.
 *   2. A re-encoded session-token JWT — the mandatory mirror for the Edge
 *      proxy, which decodes the raw cookie statelessly (no DB/Redis) and so
 *      needs `mfaVerified` baked into the token at request time.
 *
 * The instance (admin vs worker) MUST come from the MFA challenge's recorded
 * `role`, never from sniffing the request's Cookie header — a stale sibling
 * cookie would otherwise stamp the wrong session.
 *
 * Returns the new cookie name/value/maxAge for the caller to set on its
 * response, or a discriminated failure the caller must surface as a hard error
 * (leaving the challenge unredeemed so the user can retry).
 */
export async function stampSessionMfaVerified(
  userId: string,
  instance: 'admin' | 'worker',
): Promise<MfaSessionStampResult> {
  // Root-cause fix (Issue 2): resolve the secret with the SAME vars and order
  // the encoder (create-auth-instance.ts) and the Edge proxy (proxy.ts) use —
  // AUTH_SECRET first, then NEXTAUTH_SECRET. Decoding with NEXTAUTH_SECRET only
  // threw whenever AUTH_SECRET was set/differed, silently skipping the stamp
  // and trapping the user in a second challenge.
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    logger.error({ msg: '[mfa] Session stamp failed: no auth secret configured', userId });
    return { ok: false, reason: 'no_secret' };
  }

  const useSecureCookies = process.env.NODE_ENV === 'production';
  const cookieName = sessionCookieName(instance, useSecureCookies);
  // The salt MUST equal the cookie name — it is what the encoder and proxy
  // derive the encryption key with (see proxy.ts).
  const salt = cookieName;

  const cookieStore = await cookies();
  const rawToken = cookieStore.get(cookieName)?.value;
  if (!rawToken) {
    logger.error({
      msg: '[mfa] Session stamp failed: session cookie not found',
      userId,
      instance,
    });
    return { ok: false, reason: 'no_cookie' };
  }

  let decoded: JWT | null;
  try {
    decoded = await decode({ token: rawToken, secret, salt });
  } catch (err) {
    logger.error({
      msg: '[mfa] Session stamp failed: token decode threw',
      userId,
      instance,
      err,
    });
    return { ok: false, reason: 'decode_failed' };
  }

  const sessionId = decoded?.sessionId as string | undefined;
  if (!decoded || !sessionId) {
    logger.error({
      msg: '[mfa] Session stamp failed: no sessionId in decoded token',
      userId,
      instance,
    });
    return { ok: false, reason: 'no_session_id' };
  }

  // Redis: canonical per-session truth for Node request paths.
  await markSessionMfaVerified(userId, sessionId);

  // Mutate the SAME decoded payload so sessionVersion/role/organizationId/
  // sessionId all survive — do NOT reconstruct the token.
  decoded.mfaVerified = true;

  // Match session policy so the mirrored JWT's exp tracks the inactivity
  // timeout (create-auth-instance.ts session.maxAge).
  const maxAge = parseInt(process.env.INACTIVITY_TIMEOUT_MINUTES || '60', 10) * 60;

  const newToken = await encode({ token: decoded, secret, salt, maxAge });

  return { ok: true, cookieName, newToken, maxAge };
}
