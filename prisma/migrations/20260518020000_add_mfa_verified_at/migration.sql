-- Add mfaVerifiedAt to User for session-based MFA step-up verification.
-- This field stores the timestamp when the user last completed an MFA challenge,
-- allowing the JWT callback to grant mfaVerified=true for sessions within the window.

ALTER TABLE "User" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
