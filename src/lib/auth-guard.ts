/**
 * Shared authorization guard for server actions and route handlers (F-012).
 *
 * This guard READS the claims already baked into the session by
 * create-auth-instance.ts's jwt/session callbacks — `role`, `organizationId`,
 * `mfaEnabled`, `mfaVerified`. Those claims are re-validated against the DB on
 * every token decode inside the jwt() callback, so the guard performs NO new
 * DB or Redis calls; it is a pure, deterministic check over the session.
 *
 * ── How this composes with proxy.ts's page-route MFA step-up ──
 * proxy.ts (Next.js middleware) guards *page navigations*: an unauthenticated
 * or MFA-incomplete user hitting a protected page is redirected to /login or
 * /verify-2fa. That step-up is HTML-redirect based and only covers routes in
 * the middleware matcher. It does NOT protect:
 *   - `'use server'` actions (invoked as POSTs, no page redirect), and
 *   - API route handlers outside the matcher (or that need a JSON 401/403).
 * This guard closes that gap in code: call requireActionSession() at the top of
 * an action, or guardApiSession() at the top of a route handler, to enforce the
 * SAME authentication + MFA + admin-role invariants at the data-access layer.
 * The two layers are complementary — the middleware gives users a friendly
 * redirect; this guard is the authoritative server-side enforcement.
 *
 * NOTE: This task only builds and unit-tests the guard. Retrofitting individual
 * actions/routes to call it is handled by separate batches.
 */
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';

export type AuthzErrorCode = 'UNAUTHENTICATED' | 'MFA_REQUIRED' | 'FORBIDDEN';

/**
 * Thrown by requireActionSession() when a session fails an authz check.
 * Server actions already wrap their body in try/catch and return
 * `{ success: false, error }` — catching AuthzError and surfacing `.code`
 * (or a user-safe message) fits that existing pattern.
 */
export class AuthzError extends Error {
  readonly code: AuthzErrorCode;

  constructor(code: AuthzErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthzError';
    this.code = code;
  }
}

export interface AuthGuardOptions {
  /** Require the caller to be an admin. Omit to allow any authenticated role. */
  role?: 'admin';
  /**
   * Whether to enforce MFA step-up completion. Defaults to true.
   * Set to false ONLY on the MFA-verify endpoints themselves, which must be
   * reachable by an authenticated-but-not-yet-MFA-verified session.
   */
  requireMfa?: boolean;
}

/**
 * The session shape this guard relies on. next-auth's base Session type does
 * not declare the MFA claims (they are attached at runtime by the session()
 * callback), so we narrow to an optional-superset here for type safety without
 * mutating the global next-auth module augmentation.
 */
type GuardSession =
  | (Session & {
      user?: Session['user'] & {
        role?: string;
        mfaEnabled?: boolean;
        mfaVerified?: boolean;
      };
    })
  | null
  | undefined;

/**
 * Core, side-effect-free claim check shared by both entry points.
 * Returns the failing AuthzErrorCode, or null when the session passes.
 */
function checkClaims(session: GuardSession, opts: AuthGuardOptions = {}): AuthzErrorCode | null {
  const requireMfa = opts.requireMfa !== false; // default: enforce MFA

  if (!session?.user) {
    return 'UNAUTHENTICATED';
  }

  const { user } = session;

  // MFA step-up: only relevant when the account has MFA enabled and this
  // endpoint is not itself part of the verification flow.
  if (user.mfaEnabled === true && user.mfaVerified !== true && requireMfa) {
    return 'MFA_REQUIRED';
  }

  if (opts.role === 'admin' && user.role !== 'admin') {
    return 'FORBIDDEN';
  }

  return null;
}

/**
 * Guard for `'use server'` actions. Throws AuthzError on failure so the
 * caller's existing try/catch converts it to `{ success: false, error }`.
 * Returns normally when the session is authorized.
 */
export function requireActionSession(session: GuardSession, opts?: AuthGuardOptions): void {
  const code = checkClaims(session, opts);
  if (code) {
    throw new AuthzError(code);
  }
}

/**
 * Guard for API route handlers. Returns a NextResponse (401 for
 * UNAUTHENTICATED/MFA_REQUIRED, 403 for FORBIDDEN) to short-circuit the
 * handler, or null when the session is authorized and the handler should
 * continue.
 *
 * Usage:
 *   const denied = guardApiSession(session, { role: 'admin' });
 *   if (denied) return denied;
 */
export function guardApiSession(
  session: GuardSession,
  opts?: AuthGuardOptions,
): NextResponse | null {
  const code = checkClaims(session, opts);
  if (!code) return null;

  const status = code === 'FORBIDDEN' ? 403 : 401;
  return NextResponse.json({ error: code }, { status });
}
