/**
 * MFA utility functions — TOTP generation/verification and recovery codes.
 *
 * Uses the `otpauth` library (RFC 6238 TOTP) and bcrypt for recovery code hashing.
 * TOTP secrets are encrypted at rest using AES-256-GCM derived from NEXTAUTH_SECRET.
 */

import { TOTP, Secret } from 'otpauth';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ── Configuration ─────────────────────────────────────────────────────────────

const TOTP_ISSUER = 'Theraptly LMS';
const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10; // characters per code

// ── Encryption helpers ────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('[MFA] NEXTAUTH_SECRET is not configured — cannot encrypt TOTP secrets');
  }
  // Derive a 32-byte key from the secret using SHA-256
  return crypto.createHash('sha256').update(secret).digest();
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing iv + authTag + ciphertext.
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt a base64-encoded ciphertext string encrypted with encryptSecret.
 */
export function decryptSecret(encoded: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

// ── TOTP ──────────────────────────────────────────────────────────────────────

/**
 * Generate a new TOTP secret and otpauth:// URI for QR code generation.
 */
export function generateTotpSecret(userEmail: string): { secret: string; uri: string } {
  const secret = new Secret({ size: 20 }); // 160-bit secret

  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    label: userEmail,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });

  return {
    secret: secret.base32,
    uri: totp.toString(),
  };
}

/**
 * Verify a TOTP code against a base32-encoded secret.
 * Uses a window of ±1 to account for clock drift (30-second windows).
 */
export function verifyTotpCode(base32Secret: string, code: string): boolean {
  try {
    const totp = new TOTP({
      issuer: TOTP_ISSUER,
      algorithm: 'SHA1',
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      secret: Secret.fromBase32(base32Secret),
    });

    const delta = totp.validate({
      token: code,
      window: 1, // Allow ±1 period (±30 seconds)
    });

    return delta !== null;
  } catch {
    return false;
  }
}

// ── Recovery Codes ────────────────────────────────────────────────────────────

/**
 * Generate a set of human-readable recovery codes.
 * Format: XXXXX-XXXXX (alphanumeric, excluding ambiguous chars).
 */
export function generateRecoveryCodes(): string[] {
  // Exclude ambiguous characters: 0/O, 1/I/l
  const charset = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const codes: string[] = [];

  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    let code = '';
    for (let j = 0; j < RECOVERY_CODE_LENGTH; j++) {
      if (j === RECOVERY_CODE_LENGTH / 2) code += '-';
      code += charset[crypto.randomInt(charset.length)];
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Hash a recovery code with bcrypt for storage.
 */
export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

/**
 * Verify a recovery code against a bcrypt hash.
 */
export async function verifyRecoveryCode(hash: string, code: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
