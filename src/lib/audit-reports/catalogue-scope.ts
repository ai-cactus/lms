import type { Prisma } from '@/generated/prisma/client';
import { orgCourseWhere } from '@/lib/course/org-scope';

/**
 * "Which courses an audit report accounts for" — the single definition, shared
 * by the on-screen audit-reports catalogue and the generated export.
 *
 * ⛔ SUPERSEDES the earlier ruling that the auditor catalogue spans every
 * status. That ruling reasoned that a draft is still part of what the org has
 * to account for; the maintainer has reversed it. A draft is unfinished
 * authoring, not a training obligation, and listing it in a compliance artifact
 * invites an auditor to ask about a course that was never in service.
 *
 * Scoped precisely:
 *  - only `draft` is excluded. `inactive` — a retired course — STAYS: it was in
 *    service, people took it, and its records are exactly what an audit asks
 *    for.
 *  - ARCHIVED courses also stay (Q24). Archival is not a status; it is the
 *    `archivedAt` column the `db/index.ts` query extension filters on, which is
 *    why both callers read Course off `rawPrisma`. Do not conflate the two.
 *
 * ⛔ Both callers MUST use this predicate. The screen and the PDF were only just
 * brought into agreement (#632); a status filter applied to one and not the
 * other recreates the defect where the auditor reads one number on screen and a
 * different one in the report they downloaded.
 */
export async function auditorCatalogueWhere(
  organizationId: string,
): Promise<Prisma.CourseWhereInput> {
  return { ...(await orgCourseWhere(organizationId)), status: { not: 'draft' } };
}
