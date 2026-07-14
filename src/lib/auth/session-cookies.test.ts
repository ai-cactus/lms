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
import { describe, it, expect } from 'vitest';
import { siblingCookieNames } from './session-cookies';

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
