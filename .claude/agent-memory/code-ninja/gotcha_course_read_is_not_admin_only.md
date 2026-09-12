---
name: gotcha-course-read-is-not-admin-only
description: Swapping isAdminRole(role) for can(roleKey,'course.read') widens a gate to all 8 worker roles — course.read is in workerPermissions, so the two are NOT near-equivalents.
metadata:
  type: project
---

`course.read` is held by **13 of 14 roles** — every role except `finance`. It sits in
`workerPermissions` (`src/lib/rbac/permissions.ts`), because it is what lets a learner
open their OWN course.

**Why:** a task framed as "replace the `isAdminRole` role-category helper with the
permission registry, blast radius = finance only" reads as safe, and inside the
manager tier it is (isAdminRole = the 6 manager roles; course.read = 5 of them). But
`isAdminRole` is FALSE for workers and `can(…, 'course.read')` is TRUE for them, so a
straight substitution on an admin-side gate silently admits every worker.

**How to apply:** when narrowing an `isAdminRole(x)` gate to track the registry, keep
the category check in the conjunction — `isAdminRole(x) && can(dbRoleToRoleKey(x), p)`
— unless you have verified the permission is manager-only. Verify by enumerating
`ALL_ROLES` against `can()` in a throwaway `npx tsx` script rather than reading the
registry; the role definitions are long and `workerPermissions` is a shared constant
spliced in, so grepping a role block does not show what it holds.

Landed this way in `src/lib/learn/get-learn-payload.ts` (`mayReviewWithoutEnrollment`),
which had TWO call sites to fix — the admin-session fallback and
`mayOpenWithoutEnrollment`; fixing only the first leaves the hole open for a manager
who entered Learn mode, because `enterLearnMode` mints a worker session carrying their
real manager role. Related: [[auth_instance_vs_role]], [[rbac_role_model]].
