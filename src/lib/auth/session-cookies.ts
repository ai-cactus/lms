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
