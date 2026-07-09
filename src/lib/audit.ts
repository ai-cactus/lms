/**
 * Shared audit-trail helper.
 *
 * Writes a single append-only row to the `audit_logs` table (see the `AuditLog`
 * model in prisma/audit.prisma) for security- and compliance-relevant events.
 *
 * ── Design contract ──────────────────────────────────────────────────────────
 * • BEST-EFFORT: `audit()` never throws. A failure to record an audit row must
 *   never break the calling business flow, so all errors are swallowed and
 *   logged via the structured logger. Do NOT rely on audit() for correctness —
 *   it is an observability side-channel, not a transactional guarantee.
 * • APPEND-ONLY: rows are only ever inserted, never updated or deleted.
 *
 * ── Action-name convention ───────────────────────────────────────────────────
 * `action` is a dotted, lowercase namespace of the form `<domain>.<entity>.<verb>`,
 * stable over time so it can be filtered/aggregated. Examples:
 *   • 'auth.login.success'          — a user authenticated successfully
 *   • 'auth.login.failure'          — a failed login attempt
 *   • 'auth.password.reset'         — a password reset completed
 *   • 'phi.document.access'         — PHI-bearing document was viewed/opened
 *   • 'export.download'             — an auditor/report export was downloaded
 *   • 'billing.subscription.update' — a subscription/plan was changed
 *   • 'staff.remove'                — a staff member was removed from an org
 * Prefer reusing an existing action string over inventing a near-duplicate.
 */

import { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * A single audit event. Actor/target/organization fields are optional because
 * events may be unauthenticated (e.g. a failed login) or system-originated.
 */
export interface AuditEntry {
  /** ID of the user who performed the action, if authenticated. */
  actorId?: string;
  /** Role of the actor at the time of the action (e.g. 'admin', 'worker'). */
  actorRole?: string;
  /** Dotted action name — see the action-name convention in the file header. */
  action: string;
  /** Type of the entity the action targeted (e.g. 'document', 'enrollment'). */
  targetType?: string;
  /** ID of the targeted entity. */
  targetId?: string;
  /** Organization the action occurred within, for tenant-scoped audit reads. */
  organizationId?: string;
  /** Client IP address — populate via getClientContext(). */
  ip?: string;
  /** Client user-agent string — populate via getClientContext(). */
  userAgent?: string;
  /** Arbitrary structured context. Must not contain secrets or raw PII. */
  metadata?: Record<string, unknown>;
}

/**
 * Records one audit-log row. Best-effort: on any failure it logs the error and
 * resolves normally so the caller's flow is never interrupted.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        organizationId: entry.organizationId,
        ip: entry.ip,
        userAgent: entry.userAgent,
        metadata:
          entry.metadata === undefined
            ? undefined
            : (entry.metadata as unknown as Prisma.InputJsonValue),
      },
    });
  } catch (err) {
    // Never let an audit failure break the business flow — record and move on.
    logger.error({ msg: '[audit] Failed to write audit log', err, action: entry.action });
  }
}

/**
 * Minimal shape shared by the Web `Headers` object and Next.js's
 * `ReadonlyHeaders` (returned by `headers()`), so call sites can pass either.
 */
interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Extracts the best-effort client IP and user-agent from a request's headers,
 * ready to spread into an {@link AuditEntry}.
 *
 * @example
 *   const ctx = getClientContext(req.headers);
 *   await audit({ action: 'auth.login.success', actorId, ...ctx });
 *
 * @example
 *   const ctx = getClientContext(await headers()); // Next.js server context
 */
export function getClientContext(headers: HeaderReader): {
  ip?: string;
  userAgent?: string;
} {
  // x-forwarded-for may be a comma-separated list; the first entry is the client.
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    undefined;
  const userAgent = headers.get('user-agent')?.trim() || undefined;
  return { ip, userAgent };
}
