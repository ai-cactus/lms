/**
 * Unit tests for the dependency-free sibling-cookie-name helper.
 *
 * `siblingCookieNames` is the single source of truth both
 * `create-auth-instance.ts` (ISSUE 4 — clear the sibling on a successful login)
 * and `session-bridge.ts` (`clearSiblingSessionCookie`, used by logout) rely on
 * to compute which cookie names to delete. It must return BOTH the `__Secure-`
 * and plain variants so cookie clearing works regardless of which one the
 * current environment (dev vs. production) actually set.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  siblingCookieNames,
  siblingEvictedCookieNames,
  expireSiblingSessionCookies,
  markSiblingSessionEvicted,
  sessionCookieName,
  SIBLING_EVICTED_COOKIE_SUFFIX,
} from './session-cookies';

describe('sessionCookieName', () => {
  it.each([
    ['admin', false, 'admin.session-token'],
    ['worker', false, 'worker.session-token'],
    ['admin', true, '__Secure-admin.session-token'],
    ['worker', true, '__Secure-worker.session-token'],
  ] as const)('instance=%s useSecureCookies=%s -> %s', (instance, useSecureCookies, expected) => {
    expect(sessionCookieName(instance, useSecureCookies)).toBe(expected);
  });
});

describe('siblingCookieNames', () => {
  it("returns the worker instance's cookie name pair when the current instance is admin", () => {
    expect(siblingCookieNames('admin')).toEqual([
      '__Secure-worker.session-token',
      'worker.session-token',
    ]);
  });

  it("returns the admin instance's cookie name pair when the current instance is worker", () => {
    expect(siblingCookieNames('worker')).toEqual([
      '__Secure-admin.session-token',
      'admin.session-token',
    ]);
  });

  it('always returns exactly two names — the __Secure- and plain variants', () => {
    for (const current of ['admin', 'worker'] as const) {
      const names = siblingCookieNames(current);
      expect(names).toHaveLength(2);
      expect(names[0]).toMatch(/^__Secure-/);
      expect(names[1]).not.toMatch(/^__Secure-/);
    }
  });
});

describe('expireSiblingSessionCookies', () => {
  it('expires both sibling variants with a Secure attribute only on the __Secure- name', () => {
    const set = vi.fn();
    expireSiblingSessionCookies({ set }, 'worker');

    // The `__Secure-` prefixed deletion MUST carry Secure or the browser rejects
    // it under https; the plain variant must not require it.
    expect(set).toHaveBeenCalledWith(
      '__Secure-admin.session-token',
      '',
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', secure: true }),
    );
    expect(set).toHaveBeenCalledWith(
      'admin.session-token',
      '',
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', secure: false }),
    );
  });

  it('emits an expired cookie (empty value, epoch expiry, zero max-age)', () => {
    const set = vi.fn();
    expireSiblingSessionCookies({ set }, 'admin');

    for (const call of set.mock.calls) {
      expect(call[1]).toBe('');
      expect(call[2]).toMatchObject({ maxAge: 0, expires: new Date(0) });
    }
  });
});

describe('siblingEvictedCookieNames', () => {
  it("returns the worker instance's eviction-marker cookie name pair when the current instance is admin", () => {
    expect(siblingEvictedCookieNames('admin')).toEqual([
      `__Secure-worker.${SIBLING_EVICTED_COOKIE_SUFFIX}`,
      `worker.${SIBLING_EVICTED_COOKIE_SUFFIX}`,
    ]);
  });

  it("returns the admin instance's eviction-marker cookie name pair when the current instance is worker", () => {
    expect(siblingEvictedCookieNames('worker')).toEqual([
      `__Secure-admin.${SIBLING_EVICTED_COOKIE_SUFFIX}`,
      `admin.${SIBLING_EVICTED_COOKIE_SUFFIX}`,
    ]);
  });
});

describe('markSiblingSessionEvicted', () => {
  it('sets both sibling eviction-marker variants with a Secure attribute only on the __Secure- name', () => {
    const set = vi.fn();
    markSiblingSessionEvicted({ set }, 'worker');

    expect(set).toHaveBeenCalledWith(
      `__Secure-admin.${SIBLING_EVICTED_COOKIE_SUFFIX}`,
      '1',
      expect.objectContaining({ path: '/', httpOnly: false, sameSite: 'lax', secure: true }),
    );
    expect(set).toHaveBeenCalledWith(
      `admin.${SIBLING_EVICTED_COOKIE_SUFFIX}`,
      '1',
      expect.objectContaining({ path: '/', httpOnly: false, sameSite: 'lax', secure: false }),
    );
  });

  it('sets the marker with a 60s max-age (self-clearing) for every variant', () => {
    const set = vi.fn();
    markSiblingSessionEvicted({ set }, 'admin');

    expect(set).toHaveBeenCalledTimes(2);
    for (const call of set.mock.calls) {
      expect(call[2]).toMatchObject({ maxAge: 60 });
    }
  });

  it('is non-httpOnly on every variant (must be readable by the login page client script)', () => {
    const set = vi.fn();
    markSiblingSessionEvicted({ set }, 'admin');

    for (const call of set.mock.calls) {
      expect(call[2]).toMatchObject({ httpOnly: false });
    }
  });

  it('parities its Secure-attribute rule with expireSiblingSessionCookies for the same instance', () => {
    const evictedSet = vi.fn();
    const expiredSet = vi.fn();
    markSiblingSessionEvicted({ set: evictedSet }, 'worker');
    expireSiblingSessionCookies({ set: expiredSet }, 'worker');

    const secureByName = (calls: unknown[][]) =>
      new Map(
        calls.map((call) => [call[0] as string, (call[2] as { secure?: boolean }).secure ?? false]),
      );

    const evictedSecure = secureByName(evictedSet.mock.calls);
    const expiredSecure = secureByName(expiredSet.mock.calls);

    // Same cookie-name-prefix pair (admin), so the __Secure- rule must agree
    // between the two cookie kinds even though the values/max-age differ.
    expect(evictedSecure.get(`__Secure-admin.${SIBLING_EVICTED_COOKIE_SUFFIX}`)).toBe(true);
    expect(expiredSecure.get('__Secure-admin.session-token')).toBe(true);
    expect(evictedSecure.get(`admin.${SIBLING_EVICTED_COOKIE_SUFFIX}`)).toBe(false);
    expect(expiredSecure.get('admin.session-token')).toBe(false);
  });
});
