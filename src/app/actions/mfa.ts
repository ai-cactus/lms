'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { headers } from 'next/headers';
import {
  generateTotpSecret,
  verifyTotpCode,
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '@/lib/mfa';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

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
 * Step 1: Generate a TOTP secret and return the otpauth:// URI for QR display.
 * The factor is stored as unverified — the user must verify with a code to activate.
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

  const { secret, uri } = generateTotpSecret(user.email);
  const encryptedSecret = encryptSecret(secret);

  await prisma.mfaFactor.create({
    data: {
      userId: session.user.id,
      type: 'totp',
      secret: encryptedSecret,
      name: 'Authenticator App',
      verified: false,
    },
  });

  logger.info({ msg: 'MFA setup initiated', userId: session.user.id });

  return {
    success: true,
    data: { uri, secret },
  };
}

/**
 * Step 2: Verify the first TOTP code from the authenticator app.
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
    where: { userId: session.user.id, type: 'totp', verified: false },
  });

  if (!factor?.secret) {
    return { success: false, error: 'No pending MFA setup found. Start setup again.' };
  }

  const decryptedSecret = decryptSecret(factor.secret);
  const valid = verifyTotpCode(decryptedSecret, code);

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
      data: { mfaEnabled: true },
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

  logger.info({ msg: 'MFA enabled successfully', userId: session.user.id });

  // Return the plaintext codes — these match what was just stored and hashed above
  return {
    success: true,
    data: { recoveryCodes },
  };
}

/**
 * Disable MFA for the current user. Requires a valid TOTP code or recovery code.
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
 * Regenerate recovery codes. Requires a valid TOTP code.
 */
export async function regenerateRecoveryCodes(code: string): Promise<MfaActionResult> {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  if (!code) {
    return { success: false, error: 'Verification code is required' };
  }

  // Verify TOTP code only (not recovery code — security measure)
  const factor = await prisma.mfaFactor.findFirst({
    where: { userId: session.user.id, type: 'totp', verified: true },
  });

  if (!factor?.secret) {
    return { success: false, error: 'MFA not configured' };
  }

  const decryptedSecret = decryptSecret(factor.secret);
  if (!verifyTotpCode(decryptedSecret, code)) {
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
 * Verify a TOTP code or recovery code for a user.
 * Used by both the login MFA challenge and disable MFA flows.
 *
 * If a recovery code is used, it is consumed (marked as used).
 */
export async function verifyUserMfaCode(
  userId: string,
  code: string,
): Promise<{ valid: boolean; usedRecoveryCode?: boolean }> {
  // Rate limit: 5 attempts per 15 minutes
  const { allowed } = await checkRateLimit(`mfa:${userId}`, 5, 900);
  if (!allowed) {
    logger.warn({ msg: 'MFA rate limit exceeded', userId });
    return { valid: false };
  }

  // Try TOTP first
  const factor = await prisma.mfaFactor.findFirst({
    where: { userId, type: 'totp', verified: true },
  });

  if (factor?.secret) {
    const decryptedSecret = decryptSecret(factor.secret);
    if (verifyTotpCode(decryptedSecret, code)) {
      return { valid: true };
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
