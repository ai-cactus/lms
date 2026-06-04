import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyUserMfaCode } from '@/app/actions/mfa';
import { redeemMfaChallenge } from '@/lib/mfa-challenge';
import { markSessionMfaVerified } from '@/lib/session-mfa';
import { logger } from '@/lib/logger';
import { decode } from 'next-auth/jwt';

/**
 * POST /api/auth/mfa/verify
 *
 * Verifies a TOTP or recovery code during the MFA login challenge.
 * Expects: { challenge, code }
 *
 * The challenge token is a short-lived, single-use Redis key that was
 * created during the login flow and binds the MFA verification to a
 * specific login attempt — preventing unauthenticated brute-force attacks.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { challenge, code } = body as { challenge?: string; code?: string };

    if (!challenge || !code) {
      return NextResponse.json({ error: 'Challenge token and code are required' }, { status: 400 });
    }

    // Redeem the challenge token (single-use — deleted after retrieval)
    const challengeData = await redeemMfaChallenge(challenge);
    if (!challengeData) {
      return NextResponse.json({ error: 'Invalid or expired challenge' }, { status: 401 });
    }

    const { userId, role } = challengeData;

    // Verify the user exists and has MFA enabled
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, mfaEnabled: true },
    });

    if (!user || !user.mfaEnabled) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const result = await verifyUserMfaCode(userId, code);

    if (!result.valid) {
      logger.warn({ msg: 'MFA verification failed during login', userId });
      return NextResponse.json(
        { error: result.error || 'Invalid verification code' },
        { status: 401 },
      );
    }

    // Stamp mfaVerifiedAt for backward compat (legacy sessions)
    await prisma.user.update({
      where: { id: userId },
      data: { mfaVerifiedAt: new Date() },
    });

    // Per-session MFA verification: decode the JWT from the session cookie
    // to get the sessionId claim, then mark this specific session as verified in Redis.
    try {
      const cookieHeader = req.headers.get('cookie') || '';
      const isAdmin = cookieHeader.includes('admin.session-token');
      const isWorker = cookieHeader.includes('worker.session-token');
      const cookieMatch = isAdmin
        ? cookieHeader.match(/(?:__Secure-)?admin\.session-token=([^;]+)/)
        : isWorker
          ? cookieHeader.match(/(?:__Secure-)?worker\.session-token=([^;]+)/)
          : null;

      if (cookieMatch?.[1]) {
        const salt = isAdmin
          ? process.env.NODE_ENV === 'production'
            ? '__Secure-admin.session-token'
            : 'admin.session-token'
          : process.env.NODE_ENV === 'production'
            ? '__Secure-worker.session-token'
            : 'worker.session-token';

        const decoded = await decode({
          token: decodeURIComponent(cookieMatch[1]),
          secret: process.env.NEXTAUTH_SECRET!,
          salt,
        });
        if (decoded?.sessionId) {
          await markSessionMfaVerified(userId, decoded.sessionId as string);
        }
      }
    } catch (decodeError) {
      // Non-fatal: if we can't decode, the legacy mfaVerifiedAt stamp above
      // will be picked up by sessions still using the old JWT callback logic.
      logger.warn({
        msg: 'Could not decode session cookie for per-session MFA stamp',
        error: String(decodeError),
      });
    }

    logger.info({ msg: 'MFA verification successful during login', userId });

    // Return role for client-side redirect (not from URL params)
    return NextResponse.json({
      success: true,
      role,
    });
  } catch (error) {
    logger.error({ msg: 'MFA verify error', error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
