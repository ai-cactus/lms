/**
 * Shared audit-trail helper.
 *
 * Writes a single append-only row to the `audit_logs` table (see the `AuditLog`
 * model in prisma/audit.prisma) for security- and compliance-relevant events.
 *
 * ── Design contract ──────────────────────────────────────────────────────────
 * • TWO DURABILITY TIERS. Pick deliberately:
 *
 *   `audit()` — BEST-EFFORT, never throws. All errors are swallowed and logged.
 *   Correct for telemetry: a view-logged event is not worth failing a request
 *   over. Do NOT rely on it for correctness; it is an observability
 *   side-channel, not a guarantee.
 *
 *   `auditCritical()` — THROWS, and can join the caller's transaction. For the
 *   events an auditor will ask about (auth outcomes, authorization changes, PHI
 *   access, exports, billing, break-glass), where a missing row changes what you
 *   can claim. See its own docblock for when to pass a transaction.
 *
 *   The split exists because a single swallow-everything helper made the audit
 *   trail unprovable: a partial outage would leave silent gaps discoverable only
 *   when someone asked for the record (F-079).
 *
 * • APPEND-ONLY: rows are only ever inserted, never updated or deleted. Enforced
 *   at the database level by revoking UPDATE/DELETE from the app role (F-080),
 *   not by convention alone.
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
    await writeAuditRow(prisma, entry);
  } catch (err) {
    // Never let an audit failure break the business flow — record and move on.
    logger.error({ msg: '[audit] Failed to write audit log', err, action: entry.action });
  }
}

/** Minimal client surface, so a transaction client can be passed in. */
type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

function writeAuditRow(client: AuditClient, entry: AuditEntry) {
  return client.auditLog.create({
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
}

/**
 * Records an audit event that must be PROVABLE, not merely observed (F-079).
 *
 * ── Why this exists alongside audit() ───────────────────────────────────────
 * `audit()` swallows every failure by design, which is right for telemetry: a
 * dashboard-view log is not worth failing a user's request over. It is wrong for
 * the events an auditor will ask about. HIPAA §164.312(b) and SOC 2 CC7 treat
 * the audit trail as a control, and a control that silently no-ops under load or
 * during a partial outage is not a control — you would discover the gap only
 * when asked to produce the record.
 *
 * Use this for the event classes where a missing row changes what you can claim:
 *   • authentication and MFA outcomes
 *   • authorization changes (role change, membership add/remove)
 *   • PHI-adjacent access and every data export
 *   • billing state changes
 *   • break-glass / system-admin actions
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * THROWS on failure. Two ways to use it, and the choice is about what should
 * happen when the write fails:
 *
 *   Pass `client` (a transaction) when the audited action is itself
 *   transactional. The row and the mutation then commit or roll back together,
 *   so the mutation cannot exist without its audit record. This is the strongest
 *   form and the right default for role changes and exports.
 *
 *   Omit `client` when the action is not transactional (e.g. a login). The write
 *   is standalone and still throws, so the caller decides — usually by failing
 *   the request. Do NOT wrap it in a bare catch; that reintroduces exactly the
 *   silent gap this function exists to close.
 *
 * @throws when the audit row cannot be written.
 */
export async function auditCritical(entry: AuditEntry, client?: AuditClient): Promise<void> {
  await writeAuditRow(client ?? prisma, entry);
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
