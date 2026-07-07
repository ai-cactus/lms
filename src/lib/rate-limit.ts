/**
 * Redis-backed sliding window rate limiter.
 * Uses a dedicated ioredis connection separate from the BullMQ blocking pool.
 *
 * Usage:
 *   const { allowed } = await checkRateLimit(`login:${ip}`, 10, 900);
 *   if (!allowed) return { error: 'Too many attempts.' };
 */

import { Redis } from 'ioredis';
import { logger } from '@/lib/logger';

const fallbackCache = new Map<string, number[]>();

/**
 * E2E-only rate-limit bypass. Double-guarded: only active when NOT in production
 * AND the explicit opt-in flag is set, so it can never disable rate limiting in
 * a real deployment. Used so the Playwright suite can exercise auth flows
 * repeatedly without tripping the login/signup limiters.
 */
const e2eBypassRateLimit =
  process.env.NODE_ENV !== 'production' && process.env.E2E_TEST_BYPASS_RATE_LIMIT === 'true';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Separate lightweight client — does NOT share with BullMQ's blocking connection pool.
// BullMQ requires maxRetriesPerRequest: null for blocking commands (BRPOP, etc.).
// This client uses standard retry behavior safe for request/response patterns.
// Exported for health check usage
export const rateLimiterRedis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining attempts in the current window */
  remaining: number;
  /** Seconds until the window resets */
  resetInSeconds: number;
}

export interface RateLimitOptions {
  /**
   * F-024 — behavior when Redis is unavailable.
   *
   * Default (`false`): fail-OPEN — fall back to the in-memory sliding window so
   * a Redis outage doesn't take down non-critical flows (e.g. AI generation).
   *
   * `true`: fail-CLOSED — deny the request (treat as over-limit) instead of
   * trusting the per-instance in-memory fallback. Use at AUTH-critical call
   * sites (login, signup, password reset, MFA, invite accept, org-code verify)
   * where a Redis outage must NOT become an unlimited brute-force window across
   * a horizontally-scaled fleet.
   */
  failClosed?: boolean;
}

/** Deny result returned when a fail-closed limiter loses its Redis backend. */
function deniedResult(windowSec: number): RateLimitResult {
  return { allowed: false, remaining: 0, resetInSeconds: windowSec };
}

/**
 * Sliding window rate limiter using a Redis sorted set.
 * Thread-safe via atomic pipeline — safe for concurrent Next.js serverless invocations.
 *
 * @param key       Unique key for this limiter (e.g. `login:127.0.0.1`)
 * @param limit     Maximum allowed attempts within the window (default: 10)
 * @param windowSec Window duration in seconds (default: 900 = 15 minutes)
 */
export async function checkRateLimit(
  key: string,
  limit = 10,
  windowSec = 900,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  if (e2eBypassRateLimit) {
    return { allowed: true, remaining: limit, resetInSeconds: windowSec };
  }

  const now = Date.now();
  const windowStart = now - windowSec * 1000;

  try {
    const pipeline = rateLimiterRedis.pipeline();
    // 1. Remove expired entries from outside the window
    pipeline.zremrangebyscore(key, '-inf', windowStart);
    // 2. Record this attempt with current timestamp as score
    pipeline.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
    // 3. Count total attempts within the window
    pipeline.zcard(key);
    // 4. Auto-expire the key after the window to prevent memory leaks
    pipeline.expire(key, windowSec);

    const results = await pipeline.exec();
    const count = (results?.[2]?.[1] as number) ?? 0;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetInSeconds: windowSec,
    };
  } catch (error) {
    // F-024: at auth-critical call sites, deny rather than trusting the
    // per-instance in-memory fallback (which would let each pod grant a fresh
    // allowance during a Redis outage).
    if (options.failClosed) {
      logger.warn({
        msg: 'Redis rate limiter unavailable, failing closed (deny)',
        error: String(error),
        key,
      });
      return deniedResult(windowSec);
    }

    logger.error({
      msg: 'Redis rate limiter failed, falling back to in-memory',
      error: String(error),
      key,
    });

    // In-memory sliding window fallback
    const windowStartFallback = now - windowSec * 1000;
    const timestamps = fallbackCache.get(key) || [];
    const validTimestamps = timestamps.filter((t) => t > windowStartFallback);
    validTimestamps.push(now);
    fallbackCache.set(key, validTimestamps);

    const count = validTimestamps.length;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetInSeconds: windowSec,
    };
  }
}

/**
 * Check rate limit without recording an attempt.
 * Use this for pre-flight checks before performing the actual operation.
 */
export async function checkRateLimitOnly(
  key: string,
  limit = 10,
  windowSec = 900,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  if (e2eBypassRateLimit) {
    return { allowed: true, remaining: limit, resetInSeconds: windowSec };
  }

  const now = Date.now();
  const windowStart = now - windowSec * 1000;

  try {
    const pipeline = rateLimiterRedis.pipeline();
    pipeline.zremrangebyscore(key, '-inf', windowStart);
    pipeline.zcard(key);
    pipeline.expire(key, windowSec);

    const results = await pipeline.exec();
    const count = (results?.[1]?.[1] as number) ?? 0;

    return {
      allowed: count < limit,
      remaining: Math.max(0, limit - count),
      resetInSeconds: windowSec,
    };
  } catch (error) {
    // F-024: fail closed at auth-critical call sites (see checkRateLimit).
    if (options.failClosed) {
      logger.warn({
        msg: 'Redis rate limiter unavailable, failing closed (deny)',
        error: String(error),
        key,
      });
      return deniedResult(windowSec);
    }

    logger.error({
      msg: 'Redis rate limiter failed, falling back to in-memory',
      error: String(error),
      key,
    });

    const windowStartFallback = now - windowSec * 1000;
    const timestamps = fallbackCache.get(key) || [];
    const validTimestamps = timestamps.filter((t) => t > windowStartFallback);

    const count = validTimestamps.length;

    return {
      allowed: count < limit,
      remaining: Math.max(0, limit - count),
      resetInSeconds: windowSec,
    };
  }
}

/**
 * Record a rate limit attempt without checking.
 * Use this after a failed operation to only count failures.
 */
export async function recordRateLimitAttempt(key: string, windowSec = 900): Promise<void> {
  if (e2eBypassRateLimit) {
    return;
  }

  const now = Date.now();
  const windowStart = now - windowSec * 1000;

  try {
    const pipeline = rateLimiterRedis.pipeline();
    pipeline.zremrangebyscore(key, '-inf', windowStart);
    pipeline.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
    pipeline.expire(key, windowSec);
    await pipeline.exec();
  } catch (error) {
    logger.error({
      msg: 'Redis rate limiter failed, falling back to in-memory',
      error: String(error),
      key,
    });

    const windowStartFallback = now - windowSec * 1000;
    const timestamps = fallbackCache.get(key) || [];
    const validTimestamps = timestamps.filter((t) => t > windowStartFallback);
    validTimestamps.push(now);
    fallbackCache.set(key, validTimestamps);
  }
}
