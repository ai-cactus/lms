/**
 * Adversarial unit tests for the Tier 3 5.1 session-revalidation Redis cache
 * (src/lib/auth/session-revalidation-cache.ts).
 *
 * This module sits directly in the auth revocation path — every authenticated
 * request's `jwt()` re-validation (see create-auth-instance.ts) can be served
 * from here instead of the DB. A bug here either (a) masks revocation beyond
 * the intended TTL, or (b) fails closed and locks out every session on a Redis
 * blip. Both are tested explicitly, along with the "never cache sensitive
 * fields" and "TTL=0 disables the cache" contracts documented in the module's
 * JSDoc.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGet, mockSet, mockLoggerError } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimiterRedis: { get: mockGet, set: mockSet },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  getCachedRevalidation,
  setCachedRevalidation,
  getRevalidationTtlSeconds,
  type RevalidationSnapshot,
} from './session-revalidation-cache';

const ORIGINAL_TTL_ENV = process.env.AUTH_REVALIDATE_TTL_SECONDS;

const snapshot: RevalidationSnapshot = {
  id: 'user-1',
  role: 'owner',
  organizationId: 'org-1',
  mfaEnabled: false,
  passwordResetRequired: false,
  sessionVersion: 1,
  authProvider: 'credentials',
  profileFullName: 'Jane Doe',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUTH_REVALIDATE_TTL_SECONDS;
});

afterEach(() => {
  if (ORIGINAL_TTL_ENV === undefined) {
    delete process.env.AUTH_REVALIDATE_TTL_SECONDS;
  } else {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = ORIGINAL_TTL_ENV;
  }
});

describe('getRevalidationTtlSeconds — env parsing', () => {
  it('defaults to 30 when unset', () => {
    expect(getRevalidationTtlSeconds()).toBe(30);
  });

  it('defaults to 30 for an empty string', () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '';
    expect(getRevalidationTtlSeconds()).toBe(30);
  });

  it('parses a valid positive integer', () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '5';
    expect(getRevalidationTtlSeconds()).toBe(5);
  });

  it('treats "0" as a real, explicit zero (disables the cache)', () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '0';
    expect(getRevalidationTtlSeconds()).toBe(0);
  });

  it('falls back to the default for a negative value (never silently disables via a bad negative env)', () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '-5';
    expect(getRevalidationTtlSeconds()).toBe(30);
  });

  it('falls back to the default for a non-numeric value', () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = 'not-a-number';
    expect(getRevalidationTtlSeconds()).toBe(30);
  });
});

describe('getCachedRevalidation — claim 3: TTL=0 behaves like pre-cache (always a miss, DB always consulted)', () => {
  it('returns null WITHOUT touching Redis when TTL is 0', async () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '0';

    const result = await getCachedRevalidation('user-1');

    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('getCachedRevalidation — cache hit / miss', () => {
  it('reads the correct namespaced key and returns the parsed snapshot on a hit', async () => {
    mockGet.mockResolvedValue(JSON.stringify(snapshot));

    const result = await getCachedRevalidation('user-1');

    expect(mockGet).toHaveBeenCalledExactlyOnceWith('session-revalidate:user-1');
    expect(result).toEqual(snapshot);
  });

  it('returns null on a plain miss (Redis returns null)', async () => {
    mockGet.mockResolvedValue(null);

    const result = await getCachedRevalidation('user-1');

    expect(result).toBeNull();
  });

  it('keys strictly per-user — a lookup for user-2 never returns user-1 cached data', async () => {
    mockGet.mockImplementation((key: string) =>
      key === 'session-revalidate:user-1'
        ? Promise.resolve(JSON.stringify(snapshot))
        : Promise.resolve(null),
    );

    const result = await getCachedRevalidation('user-2');

    expect(result).toBeNull();
  });
});

describe('getCachedRevalidation — claim 4: fail-safe on any Redis or parse error (never fail-closed to a broken session)', () => {
  it('returns null (never throws) when Redis.get rejects, and logs the failure', async () => {
    mockGet.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await getCachedRevalidation('user-1');

    expect(result).toBeNull();
    expect(mockLoggerError).toHaveBeenCalledOnce();
  });

  it('returns null (never throws) when the cached payload is corrupted JSON — a poisoned cache entry must not crash the auth path', async () => {
    mockGet.mockResolvedValue('{not-valid-json');

    const result = await getCachedRevalidation('user-1');

    expect(result).toBeNull();
    expect(mockLoggerError).toHaveBeenCalledOnce();
  });
});

describe('setCachedRevalidation — write path', () => {
  it('writes the namespaced key with the configured TTL via EX', async () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '45';

    await setCachedRevalidation('user-1', snapshot);

    expect(mockSet).toHaveBeenCalledExactlyOnceWith(
      'session-revalidate:user-1',
      JSON.stringify(snapshot),
      'EX',
      45,
    );
  });

  it('claim 3: never writes to Redis when TTL is 0', async () => {
    process.env.AUTH_REVALIDATE_TTL_SECONDS = '0';

    await setCachedRevalidation('user-1', snapshot);

    expect(mockSet).not.toHaveBeenCalled();
  });

  it('is best-effort — a Redis write failure is swallowed, never thrown, and logged', async () => {
    mockSet.mockRejectedValue(new Error('Redis unavailable'));

    await expect(setCachedRevalidation('user-1', snapshot)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledOnce();
  });
});

describe('claim 7: no sensitive material is ever cached', () => {
  it('the serialized snapshot contains exactly the documented non-sensitive fields — nothing else', async () => {
    await setCachedRevalidation('user-1', snapshot);

    const [, serialized] = mockSet.mock.calls[0];
    const persisted = JSON.parse(serialized as string);

    expect(Object.keys(persisted).sort()).toEqual(
      [
        'id',
        'role',
        'organizationId',
        'mfaEnabled',
        'passwordResetRequired',
        'sessionVersion',
        'authProvider',
        'profileFullName',
      ].sort(),
    );
  });

  // NOTE (adversarial finding, not asserted as a failing test — see report):
  // setCachedRevalidation() does a bare JSON.stringify(snapshot) with no
  // runtime field allowlist. It relies entirely on (a) TypeScript's
  // excess-property check at the one current call site in
  // create-auth-instance.ts, which passes an 8-key object LITERAL, and (b)
  // that literal's fields being sourced from a `prisma.user.findUnique`
  // `select` that never fetches `password` in the first place — so there is
  // no live path today that can smuggle a secret into the cache. But the
  // function itself has no defense-in-depth: a future call site that passes
  // a variable (e.g. the full Prisma user record) rather than a literal would
  // bypass TS's excess-property check and silently cache whatever extra
  // fields that object carries, including a password hash. Worth hardening
  // (e.g. an explicit field-pick before stringify) even though it is not
  // exploitable via any current call site.
});
