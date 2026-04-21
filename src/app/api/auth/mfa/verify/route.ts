import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyUserMfaCode } from '@/app/actions/mfa';
import { logger } from '@/lib/logger';

/**
 * POST /api/auth/mfa/verify
 *
 * Verifies a TOTP or recovery code during the MFA login challenge.
 * Expects: { userId, code }
 *
 * On success, returns a session token that the client can use to complete login.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, code } = body as { userId?: string; code?: string };

    if (!userId || !code) {
      return NextResponse.json({ error: 'User ID and code are required' }, { status: 400 });
    }

    // Verify the user exists and has MFA enabled
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, mfaEnabled: true, role: true, organizationId: true },
    });

    if (!user || !user.mfaEnabled) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const result = await verifyUserMfaCode(userId, code);

    if (!result.valid) {
      logger.warn({ msg: 'MFA verification failed during login', userId });
      return NextResponse.json(
        { error: result.usedRecoveryCode ? 'Invalid recovery code' : 'Invalid verification code' },
        { status: 401 },
      );
    }

    logger.info({ msg: 'MFA verification successful during login', userId });

    // Return user data needed to complete the sign-in
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        role: user.role,
        organizationId: user.organizationId,
        mfaVerified: true,
      },
    });
  } catch (error) {
    logger.error({ msg: 'MFA verify error', error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
