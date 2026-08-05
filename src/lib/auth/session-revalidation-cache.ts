/**
 * Short-TTL Redis cache for the JWT decode-time DB re-validation.
 *
 * On every `auth()` call the JWT callback (see `create-auth-instance.ts`)
 * re-reads the user row from Postgres to catch revocation events (deletion,
 * role change, org removal, password-reset `sessionVersion` bump). Under load
 * this is one `user.findUnique` per authenticated request, per NextAuth
 * instance. This cache lets repeated decodes within a short window reuse the
 * last snapshot and skip the DB round-trip.
 *
 * IMPORTANT — this is a *revocation-latency* trade, not a correctness change:
 * a cache hit means a revocation can lag up to the TTL (default 30s). That
 * window is deliberate and bounded (see the tradeoff note in
 * `docs/perf/tier3-implementation-plan.md` §6). It is invalidated by TTL
 * expiry only — there is intentionally no active bust here.
 *
 * Fail-safe by construction:
 *  - A Redis read error returns `null` (a cache miss) so the caller falls back
 *    to the direct DB read — never fail-closed, never mass-invalidate.
 *  - A Redis write error is swallowed — a caching blip must not break auth.
 *  - Setting `AUTH_REVALIDATE_TTL_SECONDS=0` disables the cache entirely
 *    (always read from the DB), restoring the pre-cache behavior with no deploy.
 *
 * Only non-sensitive validity data is stored — never the password hash, MFA
 * secrets, recovery codes, or any token/cookie material.
 */

import { rateLimiterRedis } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import type { Role } from '@/types/next-auth';

const REVALIDATE_PREFIX = 'session-revalidate:';
const DEFAULT_TTL_SECONDS = 30;

/**
 * The minimal, non-sensitive snapshot the JWT callback needs to re-run its
 * revocation checks. Mirrors the fields the `prisma.user.findUnique` select in
 * `create-auth-instance.ts` actually consumes (the unused `mfaVerifiedAt`
 * column is intentionally omitted — per-session MFA state is read separately
 * from the `session-mfa:` keys and is never cached here).
 */
export interface RevalidationSnapshot {
  id: string;
  role: Role;
  organizationId: string | null;
  mfaEnabled: boolean;
  passwordResetRequired: boolean;
  sessionVersion: number;
  authProvider: string | null;
  profileFullName: string | null;
}

/**
 * Resolve the cache TTL at call time so ops can tune it via env without a
 * deploy. Non-numeric or negative values fall back to the default; `0`
 * disables the cache (callers then always read from the DB).
 */
export function getRevalidationTtlSeconds(): number {
  const raw = process.env.AUTH_REVALIDATE_TTL_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_TTL_SECONDS;
  return parsed;
}

/**
 * Read a cached revalidation snapshot for a user.
 * Returns `null` on a miss, on a disabled cache (TTL 0), or on any Redis
 * error — every one of which routes the caller back to the direct DB read.
 */
export async function getCachedRevalidation(userId: string): Promise<RevalidationSnapshot | null> {
  if (getRevalidationTtlSeconds() <= 0) return null;
  try {
    const raw = await rateLimiterRedis.get(`${REVALIDATE_PREFIX}${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as RevalidationSnapshot;
  } catch (error) {
    logger.error({
      msg: '[auth] Session revalidation cache read failed, falling back to DB',
      userId,
      error: String(error),
    });
    return null;
  }
}

/**
 * Write a revalidation snapshot for a user with the configured TTL.
 * Best-effort: a disabled cache (TTL 0) or any Redis error is swallowed so a
 * caching blip can never break the auth path.
 */
export async function setCachedRevalidation(
  userId: string,
  snapshot: RevalidationSnapshot,
): Promise<void> {
  const ttl = getRevalidationTtlSeconds();
  if (ttl <= 0) return;
  try {
    await rateLimiterRedis.set(
      `${REVALIDATE_PREFIX}${userId}`,
      JSON.stringify(snapshot),
      'EX',
      ttl,
    );
  } catch (error) {
    logger.error({
      msg: '[auth] Session revalidation cache write failed',
      userId,
      error: String(error),
    });
  }
}

/**
 * Actively evict a user's cached snapshot so the next JWT decode misses the
 * cache and re-reads fresh from the DB. Call this immediately AFTER a committed
 * write that bumps the user's `sessionVersion` (role change, staff removal,
 * password reset/change), so a revocation takes effect on the user's next
 * navigation instead of lagging up to the TTL.
 *
 * Best-effort and fail-safe by design: a Redis error is caught and logged as a
 * `warn` but never rethrown — a caching hiccup must not break the surrounding
 * staff-removal / password-reset transaction. The TTL remains the backstop, so
 * a missed bust still self-heals within the window.
 */
export async function invalidateRevalidationCache(userId: string): Promise<void> {
  try {
    await rateLimiterRedis.del(`${REVALIDATE_PREFIX}${userId}`);
  } catch (error) {
    logger.warn({
      msg: '[auth] Session revalidation cache invalidation failed; TTL remains the backstop',
      userId,
      error: String(error),
    });
  }
}
