/**
 * Facility scope for the audit-report surface — and ONLY that surface.
 *
 * Audit reporting is deliberately org-wide for every role that can open it,
 * `supervisor` included, even though `resolveDataFacilityIds` narrows a
 * supervisor to their own facilities everywhere else. An audit report answers
 * "what training has this organisation delivered"; one that silently omits the
 * facilities the reader does not sit in is not a partial report, it is a wrong
 * one — an auditor handed it would draw a false conclusion about coverage. The
 * supervisor can already read the org-level course catalogue and the org
 * completion figures on this same page, so the narrowing bought inconsistency
 * rather than confidentiality.
 *
 * ⚠️ DO NOT COPY THIS TO ANY OTHER SURFACE. This is read-only reporting. The
 * widening lives here, locally, precisely so that `ORG_WIDE_FACILITY_ROLES` in
 * `@/lib/facility/scope` stays as it is: that constant gates staff rosters,
 * assignment targets and every facility-scoped WRITE, and PR #552 closed a
 * cross-facility write escalation that adding `supervisor` to it would silently
 * reopen. Anything that exposes an action — assign, enroll, edit, invite,
 * withdraw — must keep calling `resolveDataFacilityIds` directly.
 *
 * The tenant boundary is untouched: this only ever decides whether a FACILITY
 * predicate is applied. Every caller still filters on `organizationId`, and no
 * code path here can return ids from another organisation.
 */
import { resolveDataFacilityIds, type FacilityScopeSession } from '@/lib/facility/staff-where';
import type { Role } from '@/types/next-auth';

const AUDIT_REPORT_ORG_WIDE_ROLES: readonly Role[] = ['supervisor'];

/**
 * The facilities an audit report's SUBJECT data may span, or `null` for no
 * facility predicate at all. Mirrors {@link resolveDataFacilityIds}'s contract
 * — `[]` still means "see nothing", never "see everything" — and defers to it
 * for every role this surface does not deliberately widen.
 */
export async function resolveAuditFacilityIds(
  session: FacilityScopeSession,
): Promise<string[] | null> {
  if (AUDIT_REPORT_ORG_WIDE_ROLES.includes(session.user.role)) return null;
  return resolveDataFacilityIds(session);
}
