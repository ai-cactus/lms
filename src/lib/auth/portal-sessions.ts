import { cookies } from 'next/headers';
import type { Session } from 'next-auth';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { sessionCookieName } from '@/lib/auth/session-cookies';

/**
 * Both portal sessions for the current request. Either (or both) may be null —
 * callers own their precedence between the two, because it is NOT uniform.
 * Resolving that here would silently change behavior.
 */
export interface PortalSessions {
  admin: Session | null;
  worker: Session | null;
}

/**
 * Reads both portal sessions, skipping the `auth()` call for a portal whose
 * session cookie isn't on the request.
 *
 * Decoding a NextAuth JWT costs a JWE decrypt plus the re-validation work in
 * `create-auth-instance.ts`'s jwt callback (Redis, and a membership read).
 * Almost every request carries exactly one of the two cookies, so calling both
 * instances unconditionally doubles that for nothing — which is expensive on
 * hot paths like the video proxy, where the browser issues one request per
 * Range.
 */
export async function getPortalSessions(): Promise<PortalSessions> {
  const present = await presentSessionCookies();

  const [admin, worker] = await Promise.all([
    present.admin ? adminAuth() : null,
    present.worker ? workerAuth() : null,
  ]);

  return { admin: admin ?? null, worker: worker ?? null };
}

async function presentSessionCookies(): Promise<{ admin: boolean; worker: boolean }> {
  try {
    const names = (await cookies()).getAll().map((c) => c.name);
    return {
      admin: hasSessionCookie(names, 'admin'),
      worker: hasSessionCookie(names, 'worker'),
    };
  } catch {
    // No readable cookie store (called outside a request scope). Assume both are
    // present so we degrade to the original always-decode-both behavior: a
    // wrongly-absent verdict would log a signed-in user out, so this must never
    // fail closed.
    return { admin: true, worker: true };
  }
}

function hasSessionCookie(names: string[], instance: 'admin' | 'worker'): boolean {
  // Both name variants are checked because the `__Secure-` prefix depends on the
  // NODE_ENV in force when the cookie was written. The `${base}.` prefix match
  // catches NextAuth's chunked cookies (`<name>.0`, `<name>.1`, …), which it
  // emits instead of the plain name once the JWT exceeds the 4 KB cookie limit.
  const bases = [sessionCookieName(instance, true), sessionCookieName(instance, false)];
  return names.some((name) => bases.some((base) => name === base || name.startsWith(`${base}.`)));
}
