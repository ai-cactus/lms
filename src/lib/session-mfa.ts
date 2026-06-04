/**
 * Per-session MFA verification state stored in Redis.
 *
 * Replaces the global `mfaVerifiedAt` timestamp on the User record,
 * which shared MFA verification across all sessions for a user.
 * With this module, each session (identified by userId + JWT iat) has
 * its own independent MFA verification state.
 */

import { rateLimiterRedis } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const SESSION_MFA_PREFIX = 'session-mfa:';
const SESSION_MFA_TTL = parseInt(process.env.INACTIVITY_TIMEOUT_MINUTES || '60', 10) * 60;

/**
 * Mark a specific session as MFA-verified.
 * Keyed by userId + sessionId (a stable UUID generated at sign-in).
 */
export async function markSessionMfaVerified(userId: string, sessionId: string): Promise<void> {
  try {
    const key = `${SESSION_MFA_PREFIX}${userId}:${sessionId}`;
    await rateLimiterRedis.set(key, Date.now().toString(), 'EX', SESSION_MFA_TTL);
  } catch (error) {
    logger.error({
      msg: 'Failed to mark session MFA verified',
      userId,
      error: String(error),
    });
  }
}

/**
 * Check if a specific session has completed MFA verification.
 * Returns false on Redis failure (fail-closed — user must re-verify).
 */
export async function isSessionMfaVerified(userId: string, sessionId: string): Promise<boolean> {
  try {
    const key = `${SESSION_MFA_PREFIX}${userId}:${sessionId}`;
    const result = await rateLimiterRedis.get(key);
    return result !== null;
  } catch (error) {
    logger.error({
      msg: 'Failed to check session MFA status, treating as unverified',
      userId,
      error: String(error),
    });
    return false;
  }
}

/**
 * Remove MFA verification for a session.
 */
export async function clearSessionMfaVerification(
  userId: string,
  sessionId: string,
): Promise<void> {
  try {
    const key = `${SESSION_MFA_PREFIX}${userId}:${sessionId}`;
    await rateLimiterRedis.del(key);
  } catch (error) {
    logger.error({
      msg: 'Failed to clear session MFA verification',
      userId,
      error: String(error),
    });
  }
}
