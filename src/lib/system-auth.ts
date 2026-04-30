/**
 * Shared system-admin authentication helper.
 *
 * This module is intentionally NOT a Server Action so it can be safely
 * imported by both:
 *   - Next.js API Route Handlers  (src/app/api/**)
 *   - Next.js Server Actions      (src/app/actions/**)
 *
 * The cookie path was previously set to '/system', which prevented the
 * browser from sending it on requests to '/api/**'. This module reads
 * cookies() from next/headers which works in both contexts.
 */

import { cookies } from 'next/headers';
import crypto from 'crypto';
import { logger } from '@/lib/logger';

export const SYSTEM_ADMIN_COOKIE = 'system_admin_auth';

// ── Internal helpers ──────────────────────────────────────────────────────────

function getAuthSecret(): string {
  const secret =
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    (process.env.NODE_ENV === 'development' ? 'dev-fallback-secret' : undefined);

  if (!secret) {
    throw new Error('[SystemAuth] No NEXTAUTH_SECRET or AUTH_SECRET configured');
  }
  return secret;
}

function verifyToken(token: string): boolean {
  try {
    const secret = getAuthSecret();
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex === -1) return false;

    const payload = token.substring(0, dotIndex);
    const signature = token.substring(dotIndex + 1);

    if (!payload || !signature) return false;

    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return false;
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch (err) {
    logger.warn({ msg: '[SystemAuth] Token verification failed', err });
    return false;
  }
}

function isTokenExpired(token: string): boolean {
  try {
    const dotIndex = token.lastIndexOf('.');
    const payload = JSON.parse(token.substring(0, dotIndex));
    return typeof payload.exp === 'number' && Date.now() > payload.exp;
  } catch {
    return true; // treat parse failure as expired
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads the system-admin cookie from the current request and validates it.
 *
 * Works in both API Route Handlers and Server Actions.
 * Returns `true` if the request carries a valid, non-expired system-admin
 * session; `false` otherwise.
 */
export async function verifySystemAdminCookie(): Promise<boolean> {
  if (!process.env.SYSTEM_ADMIN_PASSWORD) {
    // System admin feature not enabled — deny by default.
    return false;
  }

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SYSTEM_ADMIN_COOKIE)?.value;

    if (!token) return false;
    if (!verifyToken(token)) return false;
    if (isTokenExpired(token)) return false;

    return true;
  } catch (err) {
    logger.warn({ msg: '[SystemAuth] Cookie read failed', err });
    return false;
  }
}

/**
 * Throws a structured 401 error if the request is not authenticated as a
 * system admin. Use this at the top of API Route Handlers that must be
 * gated to system admins only.
 */
export function requireSystemAdmin(isAuth: boolean): void {
  if (!isAuth) {
    throw new SystemAuthError('Unauthorized');
  }
}

export class SystemAuthError extends Error {
  readonly statusCode = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'SystemAuthError';
  }
}
