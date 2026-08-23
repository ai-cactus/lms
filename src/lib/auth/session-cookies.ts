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

/**
 * The session-token cookie name for an auth instance in the current
 * environment. Mirrors the name each NextAuth instance sets in
 * `create-auth-instance.ts` and the name the Edge proxy decodes in
 * `proxy.ts`: the `__Secure-` prefix is applied only when secure cookies are in
 * use (production). Kept here so cookie naming has a single source of truth.
 */
export function sessionCookieName(instance: 'admin' | 'worker', useSecureCookies: boolean): string {
  return `${useSecureCookies ? '__Secure-' : ''}${instance}.session-token`;
}

/**
 * Suffix of the short-lived, NON-httpOnly marker cookie that records "your
 * session on this browser was evicted because another account signed in". The
 * login page reads it via `document.cookie` (hence non-httpOnly) to surface a
 * distinct "Signed Out" notice, then clears it. Presence-only — it never
 * carries any account data.
 */
export const SIBLING_EVICTED_COOKIE_SUFFIX = 'session-evicted';

/**
 * Names of the eviction-marker cookie for the sibling instance (both the
 * `__Secure-` and plain variants), mirroring {@link siblingCookieNames}.
 */
export function siblingEvictedCookieNames(current: 'admin' | 'worker'): string[] {
  const sibling = current === 'admin' ? 'worker' : 'admin';
  return [
    `__Secure-${sibling}.${SIBLING_EVICTED_COOKIE_SUFFIX}`,
    `${sibling}.${SIBLING_EVICTED_COOKIE_SUFFIX}`,
  ];
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

/**
 * Drop a short-lived, presence-only marker cookie for the sibling instance,
 * recording that its session was just evicted by a login on `current`. The
 * login page reads it (via `document.cookie` — hence NON-httpOnly) to show a
 * distinct "you were signed out because another account signed in" notice, then
 * clears it (single-use). The 60s max-age self-clears it if the evicted user
 * never lands on the login page.
 *
 * Only ever called from the login `signIn` callback, right beside
 * {@link expireSiblingSessionCookies} — a login-by-another-account is the sole
 * eviction event. It must NOT be emitted for a same-user org switch or an
 * intentional logout (see session-bridge.ts), which are not evictions.
 */
export function markSiblingSessionEvicted(
  cookieStore: MutableCookieStore,
  current: 'admin' | 'worker',
): void {
  for (const name of siblingEvictedCookieNames(current)) {
    cookieStore.set(name, '1', {
      path: '/',
      // Readable by the login page's client script — carries no account data.
      httpOnly: false,
      sameSite: 'lax',
      // A `__Secure-` prefixed name is only accepted with `Secure`; the plain
      // variant is the one that sticks in non-secure (dev) environments.
      secure: name.startsWith('__Secure-'),
      maxAge: 60,
    });
  }
}
