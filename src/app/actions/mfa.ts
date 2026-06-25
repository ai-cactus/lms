'use server';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { headers } from 'next/headers';
import {
  verifyTotpCode,
  encryptSecret,
  decryptSecret,
  encryptOtpPayload,
  decryptOtpPayload,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '@/lib/mfa';
import { logger } from '@/lib/logger';
import { checkRateLimitOnly, recordRateLimitAttempt } from '@/lib/rate-limit';
import { markSessionMfaVerified } from '@/lib/session-mfa';

// ── Types ─────────────────────────────────────────────────────────────────────

type MfaActionResult =
  | { success: true; data?: Record<string, unknown> }
  | { success: false; error: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveSession() {
  const headersList = await headers();
  const referer = headersList.get('referer');
  const isWorkerRoute = referer?.includes('/worker');

  if (isWorkerRoute) {
    const worker = await workerAuth();
    if (worker?.user?.id) return worker;
  } else {
    const admin = await adminAuth();
    if (admin?.user?.id) return admin;
  }

  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

// ── MFA Setup ─────────────────────────────────────────────────────────────────

/**
 * Step 1: Generate a one-time email OTP and send it to the user.
 * The factor is stored as unverified — the user must verify with the code to activate.
 */
export async function requestMfaSetup(): Promise<MfaActionResult> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Check if MFA is already enabled
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true, email: true },
  });

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (user.mfaEnabled) {
    return { success: false, error: 'MFA is already enabled. Disable it first to reconfigure.' };
  }

  // Remove any existing unverified factors
  await prisma.mfaFactor.deleteMany({
    where: { userId: session.user.id, verified: false },
  });

  // Rate limit OTP sends: 3 per 15 minutes
  const { allowed: sendAllowed } = await checkRateLimitOnly(`mfa-send:${session.user.id}`, 3, 900);
  if (!sendAllowed) {
    return { success: false, error: 'Too many code requests. Please try again later.' };
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const encryptedSecret = encryptOtpPayload(code);

  await prisma.mfaFactor.create({
    data: {
      userId: session.user.id,
      type: 'email',
      secret: encryptedSecret,
      name: 'Email OTP',
      verified: false,
    },
  });

  const { sendMfaOtpEmail } = await import('@/lib/email');
  await sendMfaOtpEmail(user.email, code);
  await recordRateLimitAttempt(`mfa-send:${session.user.id}`, 900);

  logger.info({ msg: 'MFA setup initiated via email', userId: session.user.id });

  return {
    success: true,
  };
}

/**
 * Step 2: Verify the email OTP entered by the user.
 * On success, enables MFA and generates recovery codes.
 */
export async function verifyMfaSetup(code: string): Promise<MfaActionResult> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!code || code.length !== 6) {
    return { success: false, error: 'Please enter a valid 6-digit code' };
  }

  // Find the unverified factor
  const factor = await prisma.mfaFactor.findFirst({
    where: { userId: session.user.id, verified: false },
  });

  if (!factor?.secret) {
    return { success: false, error: 'No pending MFA setup found. Start setup again.' };
  }

  let valid = false;
  if (factor.type === 'totp') {
    const decryptedSecret = decryptSecret(factor.secret);
    valid = verifyTotpCode(decryptedSecret, code);
  } else if (factor.type === 'email') {
    const otpPayload = decryptOtpPayload(factor.secret);
    if (!otpPayload) {
      return { success: false, error: 'Code already used or invalid. Start setup again.' };
    }
    if (otpPayload.expired) {
      return { success: false, error: 'Code has expired. Please request a new one.' };
    }
    valid = otpPayload.code === code;
  }

  if (!valid) {
    logger.warn({ msg: 'MFA setup verification failed: invalid code', userId: session.user.id });
    return { success: false, error: 'Invalid verification code. Please try again.' };
  }

  // Capture plaintext codes BEFORE hashing — these are shown to the user once only
  const recoveryCodes = generateRecoveryCodes();

  // Mark factor as verified and enable MFA
  await prisma.$transaction(async (tx) => {
    await tx.mfaFactor.update({
      where: { id: factor.id },
      data: { verified: true },
    });

    await tx.user.update({
      where: { id: session.user.id },
      data: {
        mfaEnabled: true,
        // Keep mfaVerifiedAt for backward compat (legacy sessions may still read it)
        mfaVerifiedAt: new Date(),
      },
    });

    // Remove any old recovery codes
    await tx.mfaRecoveryCode.deleteMany({
      where: { userId: session.user.id },
    });

    // Hash and store the SAME codes we will return to the user
    const hashedCodes = await Promise.all(recoveryCodes.map((c) => hashRecoveryCode(c)));

    await tx.mfaRecoveryCode.createMany({
      data: hashedCodes.map((codeHash) => ({
        userId: session.user.id!,
        codeHash,
      })),
    });
  });

  // Mark the current session as MFA-verified via Redis (per-session state).
  // This prevents the middleware from redirecting the user to /verify-2fa
  // immediately after they just completed setup.
  const sessionId = (session.user as Record<string, unknown>).sessionId as string | undefined;
  if (sessionId) {
    await markSessionMfaVerified(session.user.id, sessionId);
  }

  logger.info({ msg: 'MFA enabled successfully', userId: session.user.id });

  // Return the plaintext codes — these match what was just stored and hashed above
  return {
    success: true,
    data: { recoveryCodes },
  };
}

/**
 * Disable MFA for the current user. Requires a valid email OTP or recovery code.
 */
export async function disableMfa(code: string): Promise<MfaActionResult> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!code) {
    return { success: false, error: 'Verification code is required' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true },
  });

  if (!user?.mfaEnabled) {
    return { success: false, error: 'MFA is not enabled' };
  }

  // Verify the code (TOTP or recovery)
  const isValid = await verifyUserMfaCode(session.user.id, code);
  if (!isValid) {
    return { success: false, error: 'Invalid verification code' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.mfaFactor.deleteMany({ where: { userId: session.user.id } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: session.user.id } });
    await tx.user.update({
      where: { id: session.user.id },
      data: { mfaEnabled: false },
    });
  });

  logger.info({ msg: 'MFA disabled', userId: session.user.id });

  return { success: true };
}

/**
 * Regenerate recovery codes. Requires a valid email OTP.
 */
export async function regenerateRecoveryCodes(code: string): Promise<MfaActionResult> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!code) {
    return { success: false, error: 'Verification code is required' };
  }

  // Verify code only against primary factor (not recovery code — security measure)
  const factor = await prisma.mfaFactor.findFirst({
    where: { userId: session.user.id, verified: true },
  });

  if (!factor?.secret) {
    return { success: false, error: 'MFA not configured' };
  }

  let valid = false;
  if (factor.type === 'totp') {
    const decryptedSecret = decryptSecret(factor.secret);
    valid = verifyTotpCode(decryptedSecret, code);
  } else if (factor.type === 'email') {
    const otpPayload = decryptOtpPayload(factor.secret);
    if (otpPayload && !otpPayload.expired) {
      valid = otpPayload.code === code;
    }
    if (valid) {
      await prisma.mfaFactor.update({
        where: { id: factor.id },
        data: { secret: encryptSecret('USED') },
      });
    }
  }

  if (!valid) {
    return { success: false, error: 'Invalid verification code' };
  }

  // Generate new recovery codes
  const recoveryCodes = generateRecoveryCodes();

  await prisma.$transaction(async (tx) => {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: session.user.id } });
    const hashedCodes = await Promise.all(recoveryCodes.map((c) => hashRecoveryCode(c)));
    await tx.mfaRecoveryCode.createMany({
      data: hashedCodes.map((codeHash) => ({
        userId: session.user.id!,
        codeHash,
      })),
    });
  });

  logger.info({ msg: 'Recovery codes regenerated', userId: session.user.id });

  return {
    success: true,
    data: { recoveryCodes },
  };
}

// ── MFA Verification (used during login) ──────────────────────────────────────

/**
 * Verify an email OTP or recovery code for a user.
 * Used by both the login MFA challenge and disable MFA flows.
 *
 * If a recovery code is used, it is consumed (marked as used).
 */
export async function verifyUserMfaCode(
  userId: string,
  code: string,
): Promise<{ valid: boolean; usedRecoveryCode?: boolean; error?: string }> {
  // Pre-check rate limit without recording — only failures are counted
  const { allowed } = await checkRateLimitOnly(`mfa:${userId}`, 5, 900);
  if (!allowed) {
    logger.warn({ msg: 'MFA rate limit exceeded', userId });
    return { valid: false, error: 'Too many attempts. Please try again later.' };
  }

  // Try primary factors (email or totp)
  const factor = await prisma.mfaFactor.findFirst({
    where: { userId, verified: true },
  });

  if (factor?.secret) {
    if (factor.type === 'totp') {
      const decryptedSecret = decryptSecret(factor.secret);
      if (verifyTotpCode(decryptedSecret, code)) {
        return { valid: true };
      }
    } else if (factor.type === 'email') {
      const otpPayload = decryptOtpPayload(factor.secret);
      if (!otpPayload) {
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
  }

  // Try recovery code
  const recoveryCodes = await prisma.mfaRecoveryCode.findMany({
    where: { userId, usedAt: null },
  });

  for (const rc of recoveryCodes) {
    const match = await verifyRecoveryCode(rc.codeHash, code);
    if (match) {
      // Consume the recovery code
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

/**
 * Get the MFA status for the current user (for UI display).
 */
export async function getMfaStatus(): Promise<
  | { enabled: boolean; factors: { type: string; name: string | null; verified: boolean }[] }
  | { error: string }
> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { error: 'Not authenticated' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      mfaEnabled: true,
      mfaFactors: { select: { type: true, name: true, verified: true } },
    },
  });

  if (!user) {
    return { error: 'User not found' };
  }

  return {
    enabled: user.mfaEnabled,
    factors: user.mfaFactors,
  };
}

/**
 * Send an email OTP code for login.
 */
export async function sendLoginMfaCode(userId: string): Promise<MfaActionResult> {
  // Rate limit OTP sends: 3 per 15 minutes
  const { allowed } = await checkRateLimitOnly(`mfa-send:${userId}`, 3, 900);
  if (!allowed) {
    return { success: false, error: 'Too many code requests. Please try again later.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, mfaFactors: { where: { verified: true, type: 'email' } } },
  });

  if (!user) return { success: false, error: 'User not found' };

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
 * Send a fresh email OTP for the currently authenticated user.
 * Used by the settings panel when the user wants to disable MFA —
 * they need a valid OTP to confirm the action.
 */
export async function sendDisableMfaCode(): Promise<MfaActionResult> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  // Rate limit OTP sends: 3 per 15 minutes
  const { allowed } = await checkRateLimitOnly(`mfa-send:${session.user.id}`, 3, 900);
  if (!allowed) {
    return { success: false, error: 'Too many code requests. Please try again later.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      mfaEnabled: true,
      mfaFactors: { where: { verified: true, type: 'email' } },
    },
  });

  if (!user) return { success: false, error: 'User not found' };
  if (!user.mfaEnabled) return { success: false, error: 'MFA is not enabled' };

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
  await recordRateLimitAttempt(`mfa-send:${session.user.id}`, 900);

  logger.info({ msg: 'MFA disable code sent via email', userId: session.user.id });
  return { success: true };
}
