/**
 * Names of the sibling auth instance's session cookies (both the `__Secure-`
 * and plain variants), given the current instance. The admin and worker
 * NextAuth instances each own a `{prefix}.session-token` cookie; a successful
 * login on one instance — or a logout — clears the other's.
 *
 * Kept dependency-free on purpose: it is imported by both `create-auth-instance.ts`
 * and `session-bridge.ts`, and pulling in any auth module here would create a
 * circular import (create-auth-instance → session-bridge → auth → create-auth-instance).
 */
export function siblingCookieNames(current: 'admin' | 'worker'): string[] {
  const sibling = current === 'admin' ? 'worker' : 'admin';
  return [`__Secure-${sibling}.session-token`, `${sibling}.session-token`];
}

// Minimal structural type for the mutable cookie store returned by
// `cookies()` (next/headers). Declared locally to keep this module
// dependency-free (see the file header) — importing next/headers here would
// pull server-only code into every consumer.
interface MutableCookieStore {
  set(
    name: string,
    value: string,
    options?: {
      path?: string;
      httpOnly?: boolean;
      sameSite?: 'lax' | 'strict' | 'none';
      secure?: boolean;
      expires?: Date;
      maxAge?: number;
    },
  ): unknown;
}

/**
 * Expire the sibling auth instance's session cookies on the outgoing response.
 *
 * A bare `cookieStore.delete(name)` emits a `Set-Cookie` WITHOUT the `Secure`
 * attribute. That works in dev (http, plain `worker.session-token` names) but is
 * silently REJECTED by the browser in production for the `__Secure-` prefixed
 * name (RFC 6265bis §4.1.3.1 requires a `__Secure-` cookie to carry `Secure`),
 * leaving the stale sibling session alive. Emitting the deletion as an explicit
 * expired `set()` lets us attach the `Secure` attribute the prefix demands, and
 * mirror the path/httpOnly/sameSite the live session cookie was set with.
 */
export function expireSiblingSessionCookies(
  cookieStore: MutableCookieStore,
  current: 'admin' | 'worker',
): void {
  for (const name of siblingCookieNames(current)) {
    cookieStore.set(name, '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // The `__Secure-` prefixed name MUST be deleted with `Secure`, or the
      // browser drops the deletion. The plain name may keep it too (harmless).
      secure: name.startsWith('__Secure-'),
      expires: new Date(0),
      maxAge: 0,
    });
  }
}
