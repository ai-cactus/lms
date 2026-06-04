/**
 * MFA Challenge Tokens — short-lived, single-use tokens stored in Redis.
 *
 * Replaces the previous approach of passing raw userId/role in MFA verify URLs,
 * which leaked internal IDs in browser history, proxy logs, and referrer headers.
 */

import crypto from 'crypto';
import { rateLimiterRedis } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const CHALLENGE_PREFIX = 'mfa-challenge:';
const CHALLENGE_TTL_SECONDS = 10 * 60; // 10 minutes

interface MfaChallengeData {
  userId: string;
  role: 'admin' | 'worker';
  createdAt: number;
}

/**
 * Create an MFA challenge token in Redis.
 * Returns an opaque hex string to be used as a URL parameter.
 */
export async function createMfaChallenge(
  userId: string,
  role: 'admin' | 'worker',
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const data: MfaChallengeData = { userId, role, createdAt: Date.now() };
  await rateLimiterRedis.set(
    `${CHALLENGE_PREFIX}${token}`,
    JSON.stringify(data),
    'EX',
    CHALLENGE_TTL_SECONDS,
  );
  return token;
}

/**
 * Redeem an MFA challenge token (single-use).
 * Returns the challenge data if valid, then deletes the token.
 * Returns null if token not found, expired, or already used.
 */
export async function redeemMfaChallenge(token: string): Promise<MfaChallengeData | null> {
  if (!token || token.length !== 64) return null;
  const key = `${CHALLENGE_PREFIX}${token}`;
  try {
    const pipeline = rateLimiterRedis.pipeline();
    pipeline.get(key);
    pipeline.del(key);
    const results = await pipeline.exec();
    const raw = results?.[0]?.[1] as string | null;
    if (!raw) return null;
    return JSON.parse(raw) as MfaChallengeData;
  } catch (error) {
    logger.error({ msg: 'MFA challenge redeem failed', error: String(error) });
    return null;
  }
}

/**
 * Peek at a challenge token without consuming it.
 * Used by the send endpoint to resolve userId for OTP delivery.
 */
export async function peekMfaChallenge(token: string): Promise<MfaChallengeData | null> {
  if (!token || token.length !== 64) return null;
  try {
    const raw = await rateLimiterRedis.get(`${CHALLENGE_PREFIX}${token}`);
    if (!raw) return null;
    return JSON.parse(raw) as MfaChallengeData;
  } catch (error) {
    logger.error({ msg: 'MFA challenge peek failed', error: String(error) });
    return null;
  }
}
