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
import { siblingCookieNames, expireSiblingSessionCookies } from './session-cookies';

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
