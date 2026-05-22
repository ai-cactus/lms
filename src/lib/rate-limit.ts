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

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Separate lightweight client — does NOT share with BullMQ's blocking connection pool.
// BullMQ requires maxRetriesPerRequest: null for blocking commands (BRPOP, etc.).
// This client uses standard retry behavior safe for request/response patterns.
const limiterRedis = new Redis(redisUrl, {
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
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowSec * 1000;

  try {
    const pipeline = limiterRedis.pipeline();
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
