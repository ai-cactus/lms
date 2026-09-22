---
name: rbac-sidebar-module-gating-tests
description: Exhaustive per-role sidebar/nav coverage pattern for the RBAC access matrix (canAccessModule)
metadata:
  type: project
---

Verified 2026-07-14 on branch `rbac`, after the dashboard sidebar was wired to
filter modules via `canAccessModule` (`src/lib/rbac/roles-matrix-config.ts`)
and Status Tracker access was tightened to `assignment.read`.

**This is now a fully-covered, high-risk regression surface — any future edit
to `permissions.ts` or `roles-matrix-config.ts` should re-run these three
files' exact-module-list blocks, not just spot-checks.** Added one explicit
`describe`/`it.each` block per file enumerating ALL NAVIGATION labels (Dashboard,
Documents, Courses, Status Tracker, Staff Management, Billing, Settings, Help
Center — plus Audit Reports at the component layer, since it's gated directly
on `auditPack.read` and isn't a matrix row) against the exact expected
true/false set, for all 6 manager roles (owner/admin/supervisor/hr/clinical_director/finance) + the `frontDeskAdmin`/`front_desk_admin`
representative worker:
- `src/lib/rbac/permissions.test.ts` — added a dedicated
  `organization.read + facility.read — granted to every one of the 14 roles`
  block (previously this invariant was only implied by the per-role exact-set
  tests, not asserted directly).
- `src/lib/rbac/roles-matrix-config.test.ts` — added
  `per-role NAVIGATION module list` (`describe.each` over role × label).
- `src/components/dashboard/DashboardLayoutClient.test.tsx` — added
  `exact sidebar module set for all 6 manager roles + front_desk_admin worker`,
  asserting real rendered `<Link>` presence/absence (not just the matrix
  function), including the previously-uncovered Audit Reports link.
- `src/app/dashboard/(main)/status-tracker/page.test.tsx` — new file (none
  existed before), follows the `billing/page.test.tsx` async-Server-Component
  gate pattern: owner/supervisor/hr/clinical_director render the table;
  finance and a worker role (front_desk_admin) redirect to `/dashboard`; no
  session redirects to `/login`.

Related: [[rbac-8-worker-role-split]], [[onboarding-invite-settings-phase-tests]],
[[project-test-framework]].
