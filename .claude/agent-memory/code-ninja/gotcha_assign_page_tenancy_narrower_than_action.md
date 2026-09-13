---
name: gotcha-assign-page-tenancy-narrower-than-action
description: The assign PAGE's own course lookup has no same-org clause, so it bounces a colleague-authored non-global course even though enrollUsers would accept it — check the page, not just the action, before routing traffic to it.
metadata:
  type: project
---

`src/app/dashboard/(wizard)/training/courses/[id]/assign/page.tsx` re-resolves the
course itself before rendering, with `OR: [{ isGlobal: true, status: 'published' },
{ createdByOrgUserId: organizationUserId }, { offerings: { some: { organizationId } } }]`
and `redirect('/dashboard/courses')` when nothing matches.

That set has **no same-org clause**, so it is strictly narrower than `enrollUsers`,
whose `isSameOrgCourse` branch accepts any course the caller's org owns
(see [[gotcha-assignment-action-authorization-split]]). An org-authored,
non-global course only ever gains an `OrgCourseOffering` row through explicit
adoption (`offering.ts`) or through the global-catalog upsert inside
`enrollUsers` / `assignCourseToRoles`, both gated on `course.isGlobal === true`.
So a colleague-authored course that has never been assigned matches none of the
three clauses.

**Why it matters:** the page is the canonical assign host, and the bounce is
SILENT — a redirect back to the list with no message. Supervisors author no
courses at all, so every course they see is a colleague's.

**How to apply:** before routing any surface to this page, check the page's own
gates (permission, billing, this lookup), not only the gates on the action it
submits to. The billing gate has the same shape: `hasActiveBilling` false
redirects to `/dashboard/courses` with no explanation, where the in-list
precedent (`startCreateCourse` in `CoursesListClient.tsx`) is to intercept and
open `BillingGateModal` instead of pushing.

Surfaced 2026-09-13 by Phase 3 of the assign-surface consolidation, which
retired `AssignCourseModal` and pointed the `/dashboard/courses` row action here.
Reported, deliberately not fixed in that PR.
