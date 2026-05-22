/**
 * Centralized password policy enforcement.
 *
 * Used by both server actions (authoritative) and client components (UX feedback).
 *
 * Policy:
 *  - Minimum 12 characters, maximum 128 characters
 *  - At least one uppercase letter
 *  - At least one lowercase letter
 *  - At least one digit
 *  - At least one special character (non-alphanumeric)
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  /** 0–4 strength score (one point per satisfied complexity rule) */
  strength: number;
}

const RULES: {
  test: (pw: string) => boolean;
  label: string;
}[] = [
  {
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
  },
  { test: (pw) => /[A-Z]/.test(pw), label: 'At least one uppercase letter' },
  { test: (pw) => /[a-z]/.test(pw), label: 'At least one lowercase letter' },
  { test: (pw) => /[0-9]/.test(pw), label: 'At least one number' },
  { test: (pw) => /[^A-Za-z0-9]/.test(pw), label: 'At least one special character (!@#$...)' },
];

/**
 * Validate a password against the password policy.
 *
 * Returns `{ valid, errors, strength }`.
 * - `valid` is `true` only when ALL rules pass.
 * - `errors` contains human-readable messages for every failing rule.
 * - `strength` is a 0–5 score (one point per passing rule).
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  let strength = 0;

  for (const rule of RULES) {
    if (rule.test(password)) {
      strength++;
    } else {
      errors.push(rule.label);
    }
  }

  // Enforce maximum length separately (reject, not just warn)
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`At most ${PASSWORD_MAX_LENGTH} characters`);
  }

  return {
    valid: errors.length === 0,
    errors,
    strength,
  };
}

/**
 * Returns per-rule pass/fail array — useful for real-time UI indicators.
 */
export function getPasswordChecks(password: string): { label: string; passed: boolean }[] {
  return RULES.map((rule) => ({
    label: rule.label,
    passed: rule.test(password),
  }));
}
