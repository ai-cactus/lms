import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Data retention / disposal purges (F-054).
 *
 * `runRetentionPurge` deletes expired or stale rows from tables that would
 * otherwise grow unbounded or that hold sensitive pending-signup data past its
 * usefulness. It is best-effort: every purge is isolated, logs its deleted
 * count, and never throws — so a failed purge (or an unreachable table) can
 * never abort the daily reminder sweep that hosts it.
 *
 * Retention windows follow HIPAA-sensible defaults and are individually
 * overridable via environment variables (parsed defensively; a non-finite or
 * out-of-range value falls back to the default):
 *
 *   RETENTION_VERIFICATION_TOKEN_GRACE_DAYS  default 1   (expires + grace)
 *   RETENTION_INVITE_DAYS                    default 30  (terminal invites)
 *   RETENTION_JOB_DAYS                       default 90  (terminal jobs)
 *   RETENTION_EMAIL_DAYS                     default 90  (sent emails)
 *
 * ─── AUDIT LOGS ARE NEVER PURGED HERE ───────────────────────────────────────
 * HIPAA requires audit records to be retained for at least six years. The
 * `AuditLog` table (`audit_logs`) is therefore deliberately excluded from every
 * purge in this module — do NOT add it. Disposal of PHI reports and documents
 * is likewise out of scope; that needs a separate product decision.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** HIPAA-sensible default retention windows, in days. */
const DEFAULT_VERIFICATION_TOKEN_GRACE_DAYS = 1;
const DEFAULT_INVITE_DAYS = 30;
const DEFAULT_JOB_DAYS = 90;
const DEFAULT_EMAIL_DAYS = 90;

/** Deleted-row counts per table for one purge pass. */
export interface RetentionPurgeSummary {
  verificationTokens: number;
  invites: number;
  jobs: number;
  emailMessages: number;
}

/**
 * Parse a day-count env override defensively. A non-finite or negative value
 * falls back to {@link fallback}; `0` is accepted (purge as soon as the row is
 * eligible) so a grace/window can be tightened to "no delay" if desired.
 */
function resolveWindowDays(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** The cutoff instant `days` before `now`. Rows older than this are eligible. */
function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Run one purge step in isolation: execute the delete, log a non-zero count,
 * and swallow any error (logged) so the caller's sweep is never broken.
 */
async function purgeStep(label: string, run: () => Promise<{ count: number }>): Promise<number> {
  try {
    const { count } = await run();
    if (count > 0) logger.info({ msg: `[retention] Purged ${label}`, count });
    return count;
  } catch (err) {
    logger.error({ msg: `[retention] Failed to purge ${label}`, err });
    return 0;
  }
}

/**
 * Delete expired/stale rows across the retention-managed tables. Best-effort:
 * every step is isolated and the function never throws. Returns the per-table
 * deleted counts.
 *
 * @param now Clock instant, injected for determinism/testability.
 */
export async function runRetentionPurge(now: Date): Promise<RetentionPurgeSummary> {
  logger.info({ msg: '[retention] Starting purge' });

  // VerificationToken — pending-signup data incl. hashed passwords. Purge
  // promptly once past `expires` plus a small grace.
  const verificationTokens = await purgeStep('verification tokens', () => {
    const graceDays = resolveWindowDays(
      process.env.RETENTION_VERIFICATION_TOKEN_GRACE_DAYS,
      DEFAULT_VERIFICATION_TOKEN_GRACE_DAYS,
    );
    return prisma.verificationToken.deleteMany({
      where: { expires: { lt: cutoff(now, graceDays) } },
    });
  });

  // Invite — terminal (accepted/expired) invites older than the window. Age by
  // `createdAt` (the model has no updatedAt); invites are short-lived so this is
  // a safe proxy for "long since resolved".
  const invites = await purgeStep('invites', () => {
    const inviteDays = resolveWindowDays(process.env.RETENTION_INVITE_DAYS, DEFAULT_INVITE_DAYS);
    return prisma.invite.deleteMany({
      where: {
        status: { in: ['accepted', 'expired'] },
        createdAt: { lt: cutoff(now, inviteDays) },
      },
    });
  });

  // Job — terminal (completed/failed) jobs older than the window. The jobs
  // table grows forever otherwise; age by `updatedAt` (stamped on the terminal
  // transition).
  const jobs = await purgeStep('jobs', () => {
    const jobDays = resolveWindowDays(process.env.RETENTION_JOB_DAYS, DEFAULT_JOB_DAYS);
    return prisma.job.deleteMany({
      where: {
        status: { in: ['completed', 'failed'] },
        updatedAt: { lt: cutoff(now, jobDays) },
      },
    });
  });

  // EmailMessage — successfully-sent delivery records older than the window.
  // Age by `sentAt` (the precise terminal timestamp); the `lt` filter naturally
  // excludes any row whose `sentAt` is unset. Non-terminal rows (queued/failed)
  // are left for the sweep's retry pre-pass to handle.
  const emailMessages = await purgeStep('email messages', () => {
    const emailDays = resolveWindowDays(process.env.RETENTION_EMAIL_DAYS, DEFAULT_EMAIL_DAYS);
    return prisma.emailMessage.deleteMany({
      where: {
        status: 'sent',
        sentAt: { lt: cutoff(now, emailDays) },
      },
    });
  });

  const summary: RetentionPurgeSummary = { verificationTokens, invites, jobs, emailMessages };
  logger.info({ msg: '[retention] Purge complete', ...summary });
  return summary;
}
