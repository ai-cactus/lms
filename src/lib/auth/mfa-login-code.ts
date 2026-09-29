import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { encryptSecret, encryptOtpPayload, decryptOtpPayload, verifyRecoveryCode } from '@/lib/mfa';
import { logger } from '@/lib/logger';
import { checkRateLimitOnly, recordRateLimitAttempt } from '@/lib/rate-limit';
import { isDeletedIdentity } from '@/lib/auth/deleted-identity';

/**
 * Login-MFA primitives that act on a RAW userId, with no session of their own.
 *
 * SEC-13: these used to be exported from the `'use server'` file
 * `src/app/actions/mfa.ts`, which made each one an unauthenticated,
 * HTTP-callable Server Action — anyone could email a login code to any userId,
 * or burn a user's OTP and recovery codes by guessing. They are safe only
 * behind a caller that has already resolved the userId from something it
 * trusts: the `/api/auth/mfa/*` routes (a verified login challenge) and
 * `disableMfa` (the signed-in session). Keep them out of every `'use server'`
 * module.
 */

export type LoginMfaCodeResult = { success: true } | { success: false; error: string };

/** Emails a fresh login OTP to the user's verified email factor. */
export async function sendLoginMfaCode(userId: string): Promise<LoginMfaCodeResult> {
  // Rate limit OTP sends: 3 per 15 minutes. F-024: auth-critical — fail closed.
  const { allowed } = await checkRateLimitOnly(`mfa-send:${userId}`, 3, 900, { failClosed: true });
  if (!allowed) {
    return { success: false, error: 'Too many code requests. Please try again later.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      deletedAt: true,
      mfaFactors: { where: { verified: true, type: 'email' } },
    },
  });

  // A deleted identity (Q-23) is never sent a login code.
  if (!user || isDeletedIdentity(user)) return { success: false, error: 'User not found' };

  const factor = user.mfaFactors[0];
  if (!factor) return { success: false, error: 'No email MFA factor found' };

  const code = crypto.randomInt(100000, 1000000).toString();
  const encryptedSecret = encryptOtpPayload(code);

  await prisma.mfaFactor.update({
    where: { id: factor.id },
    data: { secret: encryptedSecret },
  });

  const { sendMfaOtpEmail } = await import('@/lib/email');
  await sendMfaOtpEmail(user.email, code);
  await recordRateLimitAttempt(`mfa-send:${userId}`, 900);

  logger.info({ msg: 'MFA login code sent via email', userId });
  return { success: true };
}

/**
 * Verify an email OTP or recovery code for a user. Used by both the login MFA
 * challenge and the disable-MFA flow. A matching recovery code is consumed.
 */
export async function verifyUserMfaCode(
  userId: string,
  code: string,
): Promise<{ valid: boolean; usedRecoveryCode?: boolean; error?: string }> {
  // Pre-check rate limit without recording — only failures are counted.
  // F-024: auth-critical (OTP/recovery-code brute-force guard) — fail closed.
  const { allowed } = await checkRateLimitOnly(`mfa:${userId}`, 5, 900, { failClosed: true });
  if (!allowed) {
    logger.warn({ msg: 'MFA rate limit exceeded', userId });
    return { valid: false, error: 'Too many attempts. Please try again later.' };
  }

  const factor = await prisma.mfaFactor.findFirst({
    where: { userId, verified: true },
  });

  if (factor?.secret) {
    const otpPayload = decryptOtpPayload(factor.secret);
    if (!otpPayload) {
      // No usable OTP on file — fall through to recovery codes below.
    } else if (otpPayload.expired) {
      if (/^\d{1,6}$/.test(code)) {
        return { valid: false, error: 'Code has expired. Please request a new one.' };
      }
    } else if (otpPayload.code === code) {
      await prisma.mfaFactor.update({
        where: { id: factor.id },
        data: { secret: encryptSecret('USED') },
      });
      return { valid: true };
    }
  }

  const recoveryCodes = await prisma.mfaRecoveryCode.findMany({
    where: { userId, usedAt: null },
  });

  for (const rc of recoveryCodes) {
    const match = await verifyRecoveryCode(rc.codeHash, code);
    if (match) {
      await prisma.mfaRecoveryCode.update({
        where: { id: rc.id },
        data: { usedAt: new Date() },
      });
      logger.info({ msg: 'MFA recovery code used', userId });
      return { valid: true, usedRecoveryCode: true };
    }
  }

  // Record failed attempt only
  await recordRateLimitAttempt(`mfa:${userId}`, 900);

  return { valid: false };
}
