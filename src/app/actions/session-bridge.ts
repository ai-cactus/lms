'use server';

import crypto from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { encode } from 'next-auth/jwt';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';
import { audit } from '@/lib/audit';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { expireSiblingSessionCookies } from '@/lib/auth/session-cookies';

// Same secret resolution and cookie/salt convention the worker auth instance and
// the proxy use (AUTH_SECRET first, then NEXTAUTH_SECRET). Keeping this in lockstep
// is what lets the proxy decrypt the token we mint here.
function resolveAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('[Auth] Neither AUTH_SECRET nor NEXTAUTH_SECRET is defined.');
  }
  return secret;
}

function workerCookieName(): string {
  // Mirror create-auth-instance / proxy: `__Secure-` prefix only in production.
  return `${process.env.NODE_ENV === 'production' ? '__Secure-' : ''}worker.session-token`;
}

/**
 * Bridge a live ADMIN session into learner ("Learn") mode by minting a
 * worker-instance session cookie for the SAME user, then redirecting to /worker.
 *
 * Security: this never widens who can LOG IN to the worker portal. The admin's
 * real role is re-verified against a fresh DB read; the minted worker cookie
 * carries that admin role, which the worker instance only tolerates because its
 * `sessionAllowedRoles` (JWT re-validation) is ALL_ROLES while its login-form
 * `allowedRoles` stays WORKER_ROLES. The admin token's `sessionId` is reused so
 * an already-cleared MFA challenge carries over — no second prompt.
 */
export async function enterLearnMode(): Promise<void> {
  const session = await auth();
  const sessionUser = session?.user as
    | { id: string; name?: string | null; sessionId?: string; mfaVerified?: boolean }
    | undefined;
  const userId = sessionUser?.id;
  if (!sessionUser || !userId) {
    redirect('/login');
  }

  // Re-check role + organizationId against a fresh DB read — never trust the JWT
  // claim alone for a privilege-bearing action like minting a second session.
  const fresh = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      organizationId: true,
      mfaEnabled: true,
      authProvider: true,
      passwordResetRequired: true,
      sessionVersion: true,
      profile: { select: { fullName: true } },
    },
  });

  if (!fresh || !isAdminRole(fresh.role)) {
    logger.warn({
      msg: '[auth] enterLearnMode rejected: not an admin-tier session',
      userId,
      role: fresh?.role,
    });
    redirect('/dashboard');
  }

  let minted = false;
  try {
    const cookieName = workerCookieName();
    const secret = resolveAuthSecret();
    const maxAge = parseInt(process.env.INACTIVITY_TIMEOUT_MINUTES || '60', 10) * 60;

    // Reuse the admin session's sessionId so per-session MFA state (keyed by
    // userId + sessionId in Redis) carries over and the proxy sees a verified
    // session immediately. Fall back to a fresh id only if absent.
    const sessionId = sessionUser.sessionId ?? crypto.randomUUID();
    const name = fresh.profile?.fullName || sessionUser.name || fresh.email || 'User';

    const token = await encode({
      secret,
      salt: cookieName,
      maxAge,
      token: {
        id: fresh.id,
        email: fresh.email,
        role: fresh.role,
        organizationId: fresh.organizationId,
        name,
        mfaEnabled: fresh.mfaEnabled,
        // Carry the admin session's verified state so the proxy — which reads the
        // raw cookie directly, before any jwt() callback runs — does not force a
        // fresh /verify-2fa challenge.
        mfaVerified: sessionUser.mfaVerified ?? !fresh.mfaEnabled,
        authProvider: fresh.authProvider,
        passwordResetRequired: fresh.passwordResetRequired,
        sessionVersion: fresh.sessionVersion,
        sessionId,
      },
    });

    const cookieStore = await cookies();
    cookieStore.set(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge,
    });

    await audit({
      action: 'auth.mode_switch',
      actorId: fresh.id,
      actorRole: fresh.role,
      organizationId: fresh.organizationId ?? undefined,
      metadata: { direction: 'learn' },
    });

    logger.info({
      msg: '[auth] Admin entered learn mode',
      userId: fresh.id,
      role: fresh.role,
      email: maskEmail(fresh.email),
    });

    minted = true;
  } catch (err) {
    logger.error({ msg: '[auth] enterLearnMode failed to mint worker session', userId, err });
  }

  redirect(minted ? '/worker' : '/dashboard');
}

/**
 * Best-effort deletion of the OTHER instance's session cookie (both the
 * `__Secure-` and plain variants). Called from the confirm-logout handlers so a
 * logout on one portal also drops a bridged sibling session. Never throws.
 *
 * @param current The instance the caller is logging out FROM; the sibling is
 *   the one whose cookie is cleared.
 */
export async function clearSiblingSessionCookie(current: 'admin' | 'worker'): Promise<void> {
  try {
    const cookieStore = await cookies();
    // Emit an expired `set()` (not a bare delete) so the `__Secure-` prefixed
    // cookie is dropped WITH the `Secure` attribute the prefix requires —
    // otherwise the browser rejects the deletion under https. See
    // session-cookies.ts.
    expireSiblingSessionCookies(cookieStore, current);
  } catch (err) {
    logger.warn({ msg: '[auth] Failed to clear sibling session cookie', current, err });
  }
}
