import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyUserMfaCode } from '@/app/actions/mfa';
import { peekMfaChallenge, redeemMfaChallenge } from '@/lib/mfa-challenge';
import { stampSessionMfaVerified } from '@/lib/auth/mfa-session-stamp';
import { logger } from '@/lib/logger';

/**
 * POST /api/auth/mfa/verify
 *
 * Verifies an email OTP or recovery code during the MFA login challenge.
 * Expects: { challenge, code }
 *
 * The challenge token is a short-lived, single-use Redis key created during the
 * login flow that binds the MFA verification to a specific login attempt. It is
 * PEEKED (not consumed) up front so a wrong code cannot burn it (Issue 1); it is
 * only redeemed once verification AND the session stamp both succeed.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { challenge, code } = body as { challenge?: string; code?: string };

    if (!challenge || !code) {
      return NextResponse.json({ error: 'Challenge token and code are required' }, { status: 400 });
    }

    // Peek (non-destructive): a wrong code below must NOT consume the challenge
    // (Issue 1). Redemption happens only after the whole flow succeeds.
    const challengeData = await peekMfaChallenge(challenge);
    if (!challengeData) {
      return NextResponse.json({ error: 'Invalid or expired challenge' }, { status: 401 });
    }

    const { userId, role } = challengeData;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, mfaEnabled: true },
    });

    if (!user || !user.mfaEnabled) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const result = await verifyUserMfaCode(userId, code);
    if (!result.valid) {
      logger.warn({ msg: '[mfa] Verification failed during login', userId });
      return NextResponse.json(
        { error: result.error || 'Invalid verification code' },
        { status: 401 },
      );
    }

    // Stamp the session BEFORE redeeming the challenge. The instance comes from
    // the challenge's recorded role (authoritative), never from the Cookie
    // header. If stamping fails we return a hard error and leave the challenge
    // alive so the user can request a fresh code and retry — never a false
    // {success:true} (Issue 2).
    const stamp = await stampSessionMfaVerified(userId, role);
    if (!stamp.ok) {
      logger.error({
        msg: '[mfa] Session stamp failed during login',
        userId,
        reason: stamp.reason,
      });
      return NextResponse.json(
        { error: 'Could not complete verification. Please try again.' },
        { status: 500 },
      );
    }

    // Challenge fully consumed only now that the session is verified.
    await redeemMfaChallenge(challenge);

    // Backward compat (decision: keep this write): legacy sessions may still
    // read mfaVerifiedAt. Best-effort — the session is already verified in Redis
    // and the cookie mirror, so a failure here must not fail the request.
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { mfaVerifiedAt: new Date() },
      });
    } catch (err) {
      logger.warn({ msg: '[mfa] mfaVerifiedAt backfill failed (non-fatal)', userId, err });
    }

    const response = NextResponse.json({ success: true, role });
    response.cookies.set(stamp.cookieName, stamp.newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: stamp.maxAge,
    });

    logger.info({ msg: '[mfa] Verification successful during login', userId });
    return response;
  } catch (error) {
    logger.error({ msg: '[mfa] Verify error', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
