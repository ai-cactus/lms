/**
 * Lifetime of an email-verification token, in milliseconds.
 * Governs BOTH the initial signup token and resent tokens.
 * Must match the human-readable copy in:
 *   - src/app/(auth)/verify-email/page.tsx
 *   - src/lib/email.ts (sendEmailVerification body)
 */
export const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
