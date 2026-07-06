/**
 * Boot-time environment validation (F-042).
 *
 * validateEnv() fails fast when a genuinely-required environment variable is
 * missing or empty, so misconfiguration surfaces at process start rather than
 * as a confusing runtime error deep inside a request. It is invoked from
 * src/instrumentation.ts's register() under the Node.js runtime only.
 *
 * The required set is cross-referenced against .env.example. Truly-optional
 * integrations (Microsoft OAuth, MinIO, sweep schedules, extra Stripe price
 * IDs, etc.) are intentionally NOT required here.
 *
 * Validation is skipped during test, CI, and the production build phase —
 * mirroring the isBuildOrTest carve-out in create-auth-instance.ts — because
 * those environments legitimately run without a full secret set.
 */
import { z } from 'zod';
import { logger } from '@/lib/logger';

const requiredString = (name: string) => z.string().min(1, `${name} is required`);

/**
 * Schema over the genuinely-required variables. Email transport is validated
 * separately below because it accepts either an SMTP_* or a ZOHO_* credential
 * pair (see src/lib/email.ts).
 */
const envSchema = z.object({
  DATABASE_URL: requiredString('DATABASE_URL'),
  NEXTAUTH_SECRET: requiredString('NEXTAUTH_SECRET'),
  AUTH_SECRET: requiredString('AUTH_SECRET'),
  REDIS_URL: requiredString('REDIS_URL'),
  STRIPE_SECRET_KEY: requiredString('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: requiredString('STRIPE_WEBHOOK_SECRET'),
  GOOGLE_PROJECT_ID: requiredString('GOOGLE_PROJECT_ID'),
  GCP_BUCKET_NAME: requiredString('GCP_BUCKET_NAME'),
});

/**
 * Email needs a user + password, from either the SMTP_* or ZOHO_* pair.
 * (SMTP_HOST is optional — email.ts defaults it to smtp.zoho.com.)
 */
function validateEmailTransport(env: NodeJS.ProcessEnv): string | null {
  const hasUser = Boolean(env.SMTP_USER || env.ZOHO_MAIL_USER);
  const hasPassword = Boolean(env.SMTP_PASSWORD || env.ZOHO_MAIL_PASSWORD);
  if (hasUser && hasPassword) return null;
  return 'email transport: set SMTP_USER + SMTP_PASSWORD or ZOHO_MAIL_USER + ZOHO_MAIL_PASSWORD';
}

/**
 * Validates process.env against the required schema. Throws (aborting boot) if
 * any required variable is missing. No-op in test/CI/build environments.
 */
export function validateEnv(): void {
  const isBuildOrTest =
    process.env.NODE_ENV === 'test' ||
    process.env.CI === 'true' ||
    process.env.NEXT_PHASE === 'phase-production-build';

  if (isBuildOrTest) return;

  const issues: string[] = [];

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push(`${issue.path.join('.')}: ${issue.message}`);
    }
  }

  const emailIssue = validateEmailTransport(process.env);
  if (emailIssue) issues.push(emailIssue);

  if (issues.length > 0) {
    logger.error({ msg: '[env] Environment validation failed', issues });
    throw new Error(`[env] Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
  }

  logger.info({ msg: '[env] Environment validation passed' });
}
