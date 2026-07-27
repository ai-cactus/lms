---
name: documents-hub-rbac-gate-tests
description: Test patterns for the Documents Hub document.* registry gate (fix 867cda0) — RowActionsMenu Radix stub, no seeded finance/hr fixtures, worker roles can't reach /login at all
metadata:
  type: project
---

Context: `src/app/dashboard/(main)/documents/page.tsx` gates on
`can(dbRoleToRoleKey(role), 'document.read')` (was `isAdminRole()`), and
`DocumentListClient` takes `canUpload`/`canEdit`/`canDelete` props for Upload/Rename/Delete
visibility and the empty-state copy. Registry partition for `document.*` (verify against
`src/lib/rbac/permissions.ts` before trusting this, it can drift): full CRUD — owner,
supervisor, clinicalDirector; read-only — hr; denied (no `document.read` at all) — finance +
all 8 worker roles. See [[qa-still-open-2026-07-19-regression-tests]] for the original
discovery that this matrix is NOT uniform like billing's.

**RowActionsMenu (shared `@/components/ui` Radix dropdown) has zero existing test coverage
in this repo and no established pattern for driving it.** Rather than fight Radix's
portal/open-state internals (untested territory, same caution as "Radix Select untested in
this repo" from [[org-facility-split-test-patterns]]), stub the whole `@/components/ui`
module in the component test to render `actions` as plain `<button>`s — this targets
`DocumentListClient`'s own gating logic (which action objects it builds) rather than Radix's
rendering, and lets `getByRole('button', {name})` presence/absence assertions work
trivially. Only safe here because `DocumentListClient.tsx` imports solely `{ RowActionsMenu,
type RowAction }` from the `@/components/ui` barrel — no other barrel export is used by that
file, so the whole-module mock has no blast radius.

**No seeded finance or hr fixture exists in `prisma/seed.ts`** (only owner `admin@test.com`,
supervisor `admin2@test.com`, and worker-role users). To e2e-test the denied path, spec-local
seed a `finance`-role manager in a fresh org (finance is NOT blocked at `/login` — only
worker-category roles are). Confirmed **worker roles cannot reach `/dashboard/*` at all**:
`src/app/actions/auth.ts` redirects any `isWorkerRole()` login straight to `/worker`
regardless of which portal was used, so a worker-role fixture can never be used to exercise
an admin-route access-denied UI — same constraint already noted in
`rbac-facility-tab.spec.ts`'s own comment. Always seed a **manager**-tier denied role
(finance here) for this kind of admin-route RBAC e2e gate, never a worker role.

Every fresh spec-local org seed (this one included) needs an active `subscriptions` row per
the durable rule in [[qa-still-open-2026-07-19-regression-tests]] — copied the exact insert
from `assign-course-invite.spec.ts`.

**Registry-derived test partitioning pattern**: computed `fullAccessRoles`/`readOnlyRoles`/
`deniedRoles` at test-file top level by filtering `ALL_ROLES` through `can()` /
`dbRoleToRoleKey()` instead of hardcoding role-name arrays, then `it.each()` over each bucket
— this auto-tracks the registry if a role's grants change. Paired with one small "pin"
assertion (`expect(fullAccessRoles.sort()).toEqual([...])`) so an unexpected registry change
still fails loudly and visibly rather than silently widening/narrowing test coverage.

New test files: `src/app/dashboard/(main)/documents/page.test.tsx`,
`src/app/dashboard/(main)/documents/DocumentListClient.test.tsx`,
`tests/e2e/documents-hub-rbac-gate.spec.ts`. All ran green (28 unit tests, full 1994-test
vitest suite, both e2e tests, plus documents.spec.ts and rbac-facility-tab.spec.ts re-runs)
against a prod build (`next build` + `next start -p 3005`, CI=true) on `lms_e2e`/5433 per
[[e2e-webserver-dev-lock-conflict]]'s runbook — no product bugs found, this was a clean
regression-test addition on top of an already-correct fix.
