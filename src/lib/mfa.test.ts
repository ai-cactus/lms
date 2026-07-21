/**
 * Regression guard for the OTP expiry copy-drift bug: src/lib/email.ts's OTP
 * email template hardcoded "15 minutes" while src/lib/mfa.ts actually
 * enforced a 10-minute window. `OTP_EXPIRY_MINUTES` is now the single source
 * of truth both modules read from — pin its value so a change here can never
 * silently drift from the email copy again (see email.test.ts for the copy
 * side of this guard).
 */
import { describe, it, expect } from 'vitest';
import { OTP_EXPIRY_MINUTES } from './mfa';

describe('OTP_EXPIRY_MINUTES', () => {
  it('is 10 minutes', () => {
    expect(OTP_EXPIRY_MINUTES).toBe(10);
  });
});
