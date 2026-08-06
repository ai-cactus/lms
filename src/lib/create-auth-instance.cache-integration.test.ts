/**
 * Adversarial END-TO-END tests for the Tier 3 5.1 revalidation cache wired
 * into the real `jwt()` callback (create-auth-instance.ts + the REAL
 * session-revalidation-cache.ts — not mocked). The existing
 * create-auth-instance.test.ts mocks '@/lib/rate-limit' down to just
 * `checkRateLimit`, which leaves `rateLimiterRedis` undefined there; every
 * cache read in that file throws internally and is swallowed, so it
 * (accidentally) always falls through to the DB and never actually exercises
 * a cache HIT. This file plugs in a working in-memory fake Redis so the real
 * cache module runs its real logic, and asserts the composition end-to-end:
 *
 *  - Claim 5: a cache hit skips prisma.user.findUnique entirely; a miss calls it.
 *  - Claim 1: revocation (sessionVersion-based) lags at most the cache TTL —
 *    stays valid while a stale entry is cached, is caught the moment the entry
 *    is gone (TTL expiry simulated by deleting the key).
 *  - Claim 2: a deleted user is never masked by the cache — invalidated on the
 *    very next decode even though a fully different (earlier) user's snapshot
 *    is warm in the same cache.
 *  - Claim 3: AUTH_REVALIDATE_TTL_SECONDS=0 disables the cache — every decode
 *    reads the DB, and revocation is instant.
 *  - Claim 4: a Redis outage (get/set both throwing) falls back to the direct
 *    DB read and preserves the pre-existing DB-error fail-open behavior.
 *  - Claim 6: the retired-`admin`-role guard fires before ANY cache lookup.
 *  - TTL backstop: an out-of-band `sessionVersion` bump that never calls
 *    `invalidateRevalidationCache()` (e.g. a raw-SQL write bypassing every
 *    server action) is masked until the cache entry's real EX expires, then
 *    self-heals — contrasted against the same bump WITH the invalidation call,
 *    which is caught immediately, well inside the TTL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockFindUnique, mockCookies, fakeRedis } = vi.hoisted(() => {
  const mockCookieStore = { has: vi.fn().mockReturnValue(false), delete: vi.fn(), set: vi.fn() };

  // In-memory fake standing in for ioredis — tracks a real per-key expiry
  // timestamp (from the `EX` seconds passed to `set`) so tests can either
  // simulate "the TTL elapsed" deterministically by clearing the store
  // directly, OR drive real TTL expiry via `vi.advanceTimersByTime` for
  // tests that want to assert the actual configured TTL duration.
  const store = new Map<string, string>();
  const expiresAt = new Map<string, number>();
  const state = { failing: false };
  const fakeRedis = {
    store,
    setFailing(value: boolean) {
      state.failing = value;
    },
    get: vi.fn(async (key: string) => {
      if (state.failing) throw new Error('ECONNREFUSED: fake redis outage');
      const expiry = expiresAt.get(key);
      if (expiry !== undefined && Date.now() >= expiry) {
        store.delete(key);
        expiresAt.delete(key);
        return null;
      }
      return store.has(key) ? store.get(key)! : null;
    }),
    set: vi.fn(async (key: string, value: string, mode: string, ttl: number) => {
      void mode;
      if (state.failing) throw new Error('ECONNREFUSED: fake redis outage');
      store.set(key, value);
      expiresAt.set(key, Date.now() + ttl * 1000);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      if (state.failing) throw new Error('ECONNREFUSED: fake redis outage');
      const existed = store.delete(key);
      expiresAt.delete(key);
      return existed ? 1 : 0;
    }),
    clearAll() {
      store.clear();
      expiresAt.clear();
    },
  };

  return {
    mockFindUnique: vi.fn(),
    mockCookies: vi.fn(() => Promise.resolve(mockCookieStore)),
    fakeRedis,
  };
});

vi.mock('@/lib/prisma', () => {
  const prisma = { user: { findUnique: mockFindUnique, update: vi.fn().mockResolvedValue({}) } };
  return { prisma, default: prisma };
});
vi.mock('@/lib/rate-limit', () => ({
  rateLimiterRedis: fakeRedis,
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/session-mfa', () => ({ isSessionMfaVerified: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: mockCookies }));
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
  compare: vi.fn(),
  hash: vi.fn(),
}));
vi.mock('@/lib/enrollment/role-targets', () => ({ enrollUserForRoleTargets: vi.fn() }));
vi.mock('@/lib/enrollment/invite-courses', () => ({ enrollInviteCourses: vi.fn() }));

import { adminConfig } from '@/auth';
import { invalidateRevalidationCache } from '@/lib/auth/session-revalidation-cache';

const ORIGINAL_TTL_ENV = process.env.AUTH_REVALIDATE_TTL_SECONDS;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function decode(token: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (adminConfig.callbacks!.jwt as any)({ token });
}

const dbUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  role: 'owner',
  organizationId: 'org-1',
  mfaEnabled: false,
  mfaVerifiedAt: null,
  passwordResetRequired: false,
  sessionVersion: 1,
  authProvider: 'credentials',
  profile: { fullName: 'Owner Person' },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  fakeRedis.clearAll();
  fakeRedis.setFailing(false);
  process.env.AUTH_REVALIDATE_TTL_SECONDS = '30';
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TTL_ENV === undefined) delete process.env.AUTH_REVALIDATE_TTL_SECONDS;
  else process.env.AUTH_REVALIDATE_TTL_SECONDS = ORIGINAL_TTL_ENV;
});

describe('claim 5 — cache hit skips the DB, cache miss hits the DB', () => {
  it('a miss reads the DB and warms the cache; a subsequent decode is served from cache without calling findUnique again', async () => {
    mockFindUnique.mockResolvedValue(dbUser());
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };

    const first = await decode(token);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(first).not.toBeNull();

    mockFindUnique.mockClear();
    const second = await decode({ ...token, sessionVersion: first.sessionVersion });

    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(second).not.toBeNull();
    expect(second.role).toBe('owner');
  });
});

describe('claim 1 — sessionVersion-based revocation lags at most the cache TTL, never permanently', () => {
  it('password-change / role-change / org-unlink kill vector: a bumped sessionVersion is MASKED while the stale snapshot is still cached (bounded lag), then enforced the moment the cache entry is gone', async () => {
    // 1. Warm the cache with the pre-revocation snapshot (sessionVersion: 1).
    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 1 }));
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };
    const warmed = await decode(token);
    expect(warmed).not.toBeNull();

    // 2. Simulate a revocation event (password reset / role change / staff
    // removal all bump sessionVersion — see staff.ts, auth.ts, user.ts) that
    // happens in the DB but the cache entry is still warm and unaware of it.
    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 2 }));

    // Still within the TTL window: the cache is consulted first and still
    // holds the OLD sessionVersion, so the token (also carrying the old
    // version) is judged consistent and stays valid. This is the accepted,
    // bounded trade — assert it explicitly rather than assume it.
    mockFindUnique.mockClear();
    const stillValid = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(stillValid).not.toBeNull();

    // 3. TTL expiry (simulated: the cache entry is gone — equivalent to the
    // Redis EX having elapsed). The next decode falls through to the DB,
    // observes the bumped sessionVersion, and invalidates immediately.
    fakeRedis.store.clear();
    const afterExpiry = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(afterExpiry).toBeNull();
  });

  it('org-unlink defense-in-depth guard: a removed non-owner admin (org nulled) is masked by a stale cache entry within the TTL, then caught on expiry even though sessionVersion is also stale in the cache', async () => {
    mockFindUnique.mockResolvedValue(
      dbUser({ role: 'hr', organizationId: 'org-1', sessionVersion: 1 }),
    );
    const token = { id: 'user-1', role: 'hr', sessionVersion: 1 };
    const warmed = await decode(token);
    expect(warmed).not.toBeNull();
    expect(warmed.organizationId).toBe('org-1');

    // Staff removal in the DB: organizationId nulled AND sessionVersion bumped
    // in the same write (see removeStaff in staff.ts) — but the stale cache
    // entry still reports the OLD org and OLD version, so within the TTL the
    // removed admin's session (and the org-scoping it feeds into downstream
    // actions) is still treated as live and still org-1-scoped.
    mockFindUnique.mockResolvedValue(
      dbUser({ role: 'hr', organizationId: null, sessionVersion: 2 }),
    );
    mockFindUnique.mockClear();
    const stillMaskedByCache = await decode({ id: 'user-1', role: 'hr', sessionVersion: 1 });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(stillMaskedByCache).not.toBeNull();
    expect(stillMaskedByCache.organizationId).toBe('org-1');

    // On cache expiry, the org-removal defense-in-depth guard fires.
    fakeRedis.store.clear();
    const afterExpiry = await decode({ id: 'user-1', role: 'hr', sessionVersion: 1 });
    expect(afterExpiry).toBeNull();
  });
});

describe('claim 2 — deletion is never cached; a deleted user is rejected on the very next decode, not after the TTL', () => {
  it('a user deleted between decodes is invalidated immediately even with a warm cache for a DIFFERENT user (no cross-user leakage, no negative caching)', async () => {
    // Warm the cache for an unrelated user so the cache is genuinely "hot"
    // and not just empty by coincidence.
    mockFindUnique.mockResolvedValue(dbUser({ id: 'user-OTHER', sessionVersion: 1 }));
    await decode({ id: 'user-OTHER', role: 'owner', sessionVersion: 1 });
    expect(fakeRedis.store.has('session-revalidate:user-OTHER')).toBe(true);

    // user-1 has no cache entry (never decoded before) and has just been
    // deleted from the DB.
    mockFindUnique.mockResolvedValue(null);
    const result = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });

    expect(result).toBeNull();
    expect(fakeRedis.store.has('session-revalidate:user-1')).toBe(false);
  });

  it('never writes a cache entry for a negative (null) DB result', async () => {
    mockFindUnique.mockResolvedValue(null);

    await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });

    expect(fakeRedis.set).not.toHaveBeenCalled();
  });
});

describe('claim 3 — AUTH_REVALIDATE_TTL_SECONDS=0 behaves exactly like pre-cache: always DB, instant revocation', () => {
  it('reads the DB on every single decode, never populates the cache, and revokes the same decode a bump happens', async () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '0';
    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 1 }));
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };

    await decode(token);
    await decode(token);
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
    expect(fakeRedis.store.size).toBe(0);

    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 2 }));
    const result = await decode(token);

    expect(result).toBeNull();
  });
});

describe('claim 4 — Redis outage falls back to the direct DB read (never fail-closed, never fail-open to an unvalidated session)', () => {
  it('a Redis GET failure still reaches the DB and returns the correct, freshly-validated result', async () => {
    fakeRedis.setFailing(true);
    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 1 }));

    const result = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result.role).toBe('owner');
  });

  it('a Redis outage does not prevent revocation from being enforced (DB is still consulted and wins)', async () => {
    fakeRedis.setFailing(true);
    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 2 }));

    const result = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });

    expect(result).toBeNull();
  });

  it('a Redis SET failure (cache down for writes only) does not throw and the decode still succeeds from the DB read', async () => {
    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 1 }));
    fakeRedis.set.mockRejectedValueOnce(new Error('write failed'));

    const result = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });

    expect(result).not.toBeNull();
  });

  it('pre-existing F-036 behavior is unchanged: a DB read error (cache miss) fails OPEN, returning the token unmodified', async () => {
    mockFindUnique.mockRejectedValue(new Error('connection pool exhausted'));
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };

    const result = await decode(token);

    expect(result).toBe(token);
  });
});

describe('claim 6 — the retired-admin guard and cache lookup ordering', () => {
  it('a stale JWT carrying the retired "admin" role is rejected WITHOUT ever consulting the cache or the DB', async () => {
    const token = { id: 'user-1', role: 'admin', sessionVersion: 1 };

    const result = await decode(token);

    expect(result).toBeNull();
    expect(fakeRedis.get).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('the guard fires even when a fully valid, non-admin cache entry exists for the same userId (proves ordering, not just absence of data)', async () => {
    mockFindUnique.mockResolvedValue(dbUser({ role: 'owner', sessionVersion: 1 }));
    await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });
    expect(fakeRedis.store.has('session-revalidate:user-1')).toBe(true);

    mockFindUnique.mockClear();
    fakeRedis.get.mockClear();
    const result = await decode({ id: 'user-1', role: 'admin', sessionVersion: 1 });

    expect(result).toBeNull();
    expect(fakeRedis.get).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

/**
 * commit 66aa961 added `invalidateRevalidationCache()`, called by every server
 * action that bumps `sessionVersion` (removeStaff, role change, both
 * password-reset paths, self-service password change) — see auth.ts, staff.ts,
 * user.ts. That restores an immediate kill for every PRODUCTION revocation
 * path. This block documents and proves the semantic that motivated it stays
 * intact for the one case it does NOT cover: a `sessionVersion` bump that
 * happens OUT OF BAND — i.e. NOT through one of those actions (the canonical
 * example being a raw-SQL write, as `tests/e2e/rbac-removed-staff-login.spec.ts`
 * now documents live). That case still has to wait out the TTL; it was never
 * the guarantee this fix restores, and a future reader should not assume it
 * is. Uses a short TTL (2s) with fake timers so it stays fast and
 * deterministic rather than sleeping in real time.
 */
describe('TTL backstop vs. active invalidation for a sessionVersion bump', () => {
  it('an out-of-band bump with NO invalidateRevalidationCache() call stays masked until the short TTL elapses, then self-heals', async () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '2';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 1 }));
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };
    expect(await decode(token)).not.toBeNull();

    // Out-of-band bump: mirrors a raw-SQL UPDATE bypassing every server
    // action — invalidateRevalidationCache() is deliberately never called here.
    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 2 }));

    // 1s in: still inside the 2s TTL — masked by the stale cache entry.
    vi.advanceTimersByTime(1000);
    mockFindUnique.mockClear();
    const stillMasked = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(stillMasked).not.toBeNull();

    // Past the 2s TTL: the entry's real EX has elapsed, so the next decode
    // falls through to the DB and catches the bump — the backstop fires
    // without any active-invalidation call ever having happened.
    vi.advanceTimersByTime(1100);
    const afterTtl = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(afterTtl).toBeNull();
  });

  it('contrast: the SAME bump is caught immediately when invalidateRevalidationCache() runs, well inside the same short TTL', async () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '2';
    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 1 }));
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };
    await decode(token);
    expect(fakeRedis.store.has('session-revalidate:user-1')).toBe(true);

    mockFindUnique.mockResolvedValue(dbUser({ sessionVersion: 2 }));
    // Mirrors the call every real revoking action makes immediately after its
    // committed write (see staff.ts / auth.ts / user.ts).
    await invalidateRevalidationCache('user-1');

    mockFindUnique.mockClear();
    const result = await decode({ id: 'user-1', role: 'owner', sessionVersion: 1 });
    // Caught because the cache entry was actively busted (a miss), not
    // because the 2s TTL happened to elapse — no time advances in this test.
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
