'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { headers, cookies } from 'next/headers';
import { verifyUserMfaCode, sendLoginMfaCode } from './mfa';
import { logger } from '@/lib/logger';
import { markSessionMfaVerified } from '@/lib/session-mfa';
import { decode, encode } from 'next-auth/jwt';

async function resolveSession() {
  const headersList = await headers();
  const referer = headersList.get('referer');
  const isWorkerRoute = referer?.includes('/worker') || referer?.includes('/verify-2fa');

  if (isWorkerRoute) {
    const worker = await workerAuth();
    if (worker?.user?.id) return { session: worker, instance: 'worker' as const };
  } else {
    const admin = await adminAuth();
    if (admin?.user?.id) return { session: admin, instance: 'admin' as const };
  }

  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  if (admin?.user?.id) return { session: admin, instance: 'admin' as const };
  if (worker?.user?.id) return { session: worker, instance: 'worker' as const };
  return null;
}

/**
 * Verifies the MFA code during the login step-up flow.
 * On success, we need to mark the session as mfaVerified=true.
 * Since JWT tokens are stateless, we do this by updating the DB and
 * letting the next jwt() callback pick it up. However, NextAuth JWT
 * tokens are signed — we can't mutate them server-side.
 *
 * Approach: We store an mfaVerifiedAt timestamp in the user record.
 * The jwt callback reads this and sets mfaVerified=true in the token
 * IF the token was issued after the mfaVerifiedAt timestamp (within the session window).
 */
export async function verifyMfaChallenge(
  code: string,
): Promise<{ success: true; redirectTo: string } | { success: false; error: string }> {
  const resolved = await resolveSession();
  if (!resolved?.session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const { session, instance } = resolved;
  const userId = session.user.id;

  if (!code || (code.length !== 6 && code.length < 8)) {
    return { success: false, error: 'Please enter a valid code' };
  }

  const result = await verifyUserMfaCode(userId, code);
  if (!result.valid) {
    logger.warn({ msg: 'MFA challenge verification failed', userId });
    return { success: false, error: 'Invalid code. Please try again.' };
  }

  // Mark the session as MFA verified using per-session Redis state.
  // The JWT callback checks this Redis key (keyed by userId + sessionId)
  // instead of the global mfaVerifiedAt timestamp.
  const sessionId = (session.user as Record<string, unknown>).sessionId as string | undefined;
  if (sessionId) {
    await markSessionMfaVerified(userId, sessionId);

    // Update the session cookie directly so proxy.ts immediately knows MFA is verified
    try {
      const cookieStore = await cookies();
      const isAdmin = instance === 'admin';

      const cookieName = isAdmin
        ? process.env.NODE_ENV === 'production'
          ? '__Secure-admin.session-token'
          : 'admin.session-token'
        : process.env.NODE_ENV === 'production'
          ? '__Secure-worker.session-token'
          : 'worker.session-token';

      const rawToken = cookieStore.get(cookieName)?.value;
      if (rawToken) {
        const decoded = await decode({
          token: decodeURIComponent(rawToken),
          secret: process.env.NEXTAUTH_SECRET!,
          salt: cookieName,
        });

        if (decoded) {
          decoded.mfaVerified = true;
          const newToken = await encode({
            token: decoded,
            secret: process.env.NEXTAUTH_SECRET!,
            salt: cookieName,
          });

          const maxAge = parseInt(process.env.INACTIVITY_TIMEOUT_MINUTES || '60', 10) * 60;
          cookieStore.set(cookieName, newToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge,
          });
        }
      }
    } catch (e) {
      logger.error({ msg: 'Failed to update session cookie after step-up MFA', error: String(e) });
    }
  } else {
    // Fallback: if sessionId isn't available, use the legacy DB stamp
    await prisma.user.update({
      where: { id: userId },
      data: { mfaVerifiedAt: new Date() },
    });
  }

  logger.info({ msg: 'MFA challenge passed', userId, usedRecoveryCode: result.usedRecoveryCode });

  const redirectTo = instance === 'worker' ? '/worker' : '/dashboard';
  return { success: true, redirectTo };
}

/**
 * Send an email OTP to the currently-authenticated (but MFA-pending) user.
 * Called on mount by the /verify-2fa page, which is reached via a middleware
 * redirect — the userId is not available in the URL, so we resolve it here
 * from the session JWT.
 */
export async function sendCurrentSessionMfaCode(): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveSession();
  if (!resolved?.session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await sendLoginMfaCode(resolved.session.user.id);
  if (!result.success) {
    return { success: false, error: !result.success ? result.error : 'Failed to send code' };
  }

  return { success: true };
}
