---
name: rbac-e2e-organizationuser-fixture-port
description: Porting 6 rbac-*.spec.ts raw-SQL e2e fixtures to the User/OrganizationUser split (2026-08-03, branch multi-facility) — org-less-worker path no longer reachable, staff-profile URL is now keyed by organization_users.id, admin role un-retired
metadata:
  type: project
---

Ported 6 e2e specs' raw-`pg`-client seed/cleanup helpers from the old single
`users` table (role/organization_id/facility_id directly on it, plus a
`profiles` table) to the `User` → `OrganizationUser` /
`OrganizationUserFacility` split (migration
`20260803120000_multi_org_membership`): `rbac-invite-roles.spec.ts`,
`rbac-facility-tab.spec.ts`, `rbac-role-change.spec.ts`,
`rbac-staff-view-only.spec.ts`, `rbac-roles.spec.ts`,
`rbac-removed-staff-login.spec.ts`. All 28 tests green afterward
(`npx playwright test <these 6 files> --workers=1`). See
[[user-organizationuser-split-test-patterns]] for the unit/action-layer
version of this same refactor.

**Staff-profile route is keyed by `organization_users.id`, not `users.id`.**
`getStaffUsers()`/`getStaffDetails()` (src/app/actions/user.ts,
src/app/actions/staff.ts) both return/accept the OrganizationUser row's `id`.
Any e2e spec that navigates to `/dashboard/staff/${someId}` must pass the
seeded org-user id, not the raw user id — got this wrong on the first pass in
`rbac-role-change.spec.ts`/`rbac-staff-view-only.spec.ts` (used to be the same
value pre-refactor since role lived directly on `users`).

**RBAC ruling cascades into `rbac-role-change.spec.ts` beyond the fixture fix.**
Supervisor's new `readEverythingExceptBilling`-only permission set means it no
longer holds `user.edit` or `user.delete` — so the pre-existing
`for (const role of ['owner','supervisor','hr'])` "Assign Course" loop and the
`for (const role of ['owner','supervisor'])` "remove staff via kebab" loop both
had a stale supervisor expectation baked in. Split supervisor out into its own
test(s) asserting the *absence* of Assign Course / Remove Staff rather than
forcing the old shared assertion to pass. This is the SAME cascade documented
in [[user-organizationuser-split-test-patterns]]'s "supervisor lost almost
everything" note — expect it to keep surfacing in any e2e spec written before
the RBAC ruling landed.

**Self-serve, org-less WORKER pre-onboarding is no longer a reachable state at
all** (not just a fixture issue — a genuine behavior change worth knowing
before touching any org-less/onboarding e2e spec again). Pre-refactor, `role`
lived directly on `users` even with `organization_id NULL`, so a raw-SQL-seeded
"nurse, no org" row could log in via the shared `authenticate()` action
(src/app/actions/auth.ts) and get routed to the worker portal purely from
`user.role`. Post-refactor, role only exists on an `OrganizationUser` row, and
per `src/app/actions/auth.ts`'s `signup()` comment, self-serve signup ONLY EVER
produces an `owner`-track account — every worker account is now created via
invite/join, which attaches a membership in the same step
(`src/lib/auth/membership.ts#createMembership`). So a genuinely memberless
identity (`resolveActiveMembership()` → `{kind:'none'}`) has no signal anywhere
that it was ever "meant" to be a worker: `authenticate()` only routes to the
worker portal when an ACTIVE membership resolves to a worker role, which
`none` never does. Confirmed empirically: a "nurse"-seeded, zero-membership
identity logging in via `/login` lands on `/dashboard` (admin portal, founder
activation modal) — NOT `/worker` or `/onboarding-worker`. Rewrote
`rbac-removed-staff-login.spec.ts`'s "org-less WORKER" test to assert this new
reality (reaches `/dashboard` like the org-less OWNER case) instead of forcing
the old worker-portal assertion. The `?worker=true` query param on `/login` is
now vestigial — grepped `src/app/(auth)/login/page.tsx` and confirmed it never
reads that param; routing is 100% DB-resolved-role driven regardless of which
URL variant was visited.

**`admin` is no longer a retired role — this same migration explicitly
RE-ADDS it to the `UserRole` enum** (`prisma/migrations/
20260803120000_multi_org_membership/migration.sql` STEP 2: `ALTER TYPE
"UserRole" ADD VALUE 'admin' AFTER 'owner'`), as a full-access,
Owner-equivalent role (`src/lib/rbac/permissions.ts`'s `admin` entry uses the
same `everything` permission set as `owner`). `rbac-roles.spec.ts` had a
pre-existing "no user has the retired admin role" DB-count test whose PREMISE
is now false, not just its raw-SQL table target — flipped it to assert
`'admin'` is a valid, castable enum value instead of asserting zero rows.
`'worker'` (the old single generic role, distinct from `admin`) is still
genuinely retired — that assertion just needed its table target moved from
`users.role` to `organization_users.role`.

**Cascade note for cleanup helpers:** `organization_users_user_id_fkey` and
`organization_user_facilities_organization_user_id_fkey` are both `ON DELETE
CASCADE`, so deleting the `users` row alone would actually clean up the whole
chain — but every ported file still deletes
`organization_user_facilities` → `organization_users` → `users` explicitly
(children-before-parents), matching the task's prescribed order and staying
robust if those cascade rules ever change.

Related: [[user-organizationuser-split-test-patterns]],
[[rbac-matrix-realignment-role-change]], [[rbac-facility-tab-readonly-update]],
[[rbac-8-worker-role-split]].
