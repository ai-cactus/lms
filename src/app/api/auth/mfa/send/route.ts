import { NextResponse } from 'next/server';
import { sendLoginMfaCode } from '@/app/actions/mfa';
import { peekMfaChallenge } from '@/lib/mfa-challenge';
import { checkRateLimitOnly, recordRateLimitAttempt } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * POST /api/auth/mfa/send
 *
 * Sends an email OTP for login MFA verification.
 * Expects: { challenge }
 *
 * The challenge token is peeked (not consumed) to resolve the userId,
 * so the user can request resend without invalidating their challenge.
 */
export async function POST(req: Request) {
  try {
    // IP-based rate limit: 5 per 15 minutes
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      'unknown';
    const { allowed: ipAllowed } = await checkRateLimitOnly(`mfa-send-ip:${ip}`, 5, 900);
    if (!ipAllowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const { challenge } = body as { challenge?: string };

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge token is required' }, { status: 400 });
    }

    // Peek at the challenge (non-destructive) to resolve userId
    const challengeData = await peekMfaChallenge(challenge);
    if (!challengeData) {
      // Don't reveal whether the challenge is valid or not
      return NextResponse.json({ success: true });
    }

    // Surface a per-user rate-limit (or send failure) to the client instead of
    // masking it as success — the client shows the message and stops waiting for
    // a code that will never arrive (Issue 4).
    const result = await sendLoginMfaCode(challengeData.userId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 429 });
    }

    await recordRateLimitAttempt(`mfa-send-ip:${ip}`, 900);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ msg: 'MFA send code error', error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
