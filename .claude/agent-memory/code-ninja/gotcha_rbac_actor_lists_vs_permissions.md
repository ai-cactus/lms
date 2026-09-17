---
name: gotcha-rbac-actor-lists-vs-permissions
description: When a founder ruling is narrower than a registry permission, the answer is an actor-role list in role-utils.ts — not a grant; and `assignment.delete` reaches more than withdrawal.
metadata:
  type: project
---

The RBAC registry is strictly **four actions per resource** (`create/read/edit/delete`),
so a ruling finer than a verb cannot be expressed as a grant. The established
pattern is an **actor-role list in `src/lib/rbac/role-utils.ts`**, checked at the
call site alongside (not instead of) the facility narrowing — `ROLE_CHANGE_ACTOR_ROLES`
was first, `FACILITY_CHANGE_ACTOR_ROLES` and `STAFF_PROFILE_ACTOR_ROLES` followed
in Phase 5 (2026-09-16).

**Why:** `user.edit` gates three unrelated things at once — profile editing,
`setStaffFacilities`, and the in-place role change. Founder Q2 grants a supervisor
only the first. Granting `user.edit` would have handed them the other two, which
Rule A and Q11 explicitly reserve for Owner/Admin/HR.

**How to apply:**
- When a directive cell and the registry disagree, ask whether the permission is
  *coarser than the ruling* before reaching for a grant. If it is, add a list.
- `matrix-conformance.test.ts` asserts a justification exists for **exactly** the
  departing cells. A departure whose *reason* changes still needs its text
  rewritten — the guard checks presence, not honesty, so stale text is a silent lie.
- The lists live in `role-utils.ts`, which is client-safe by design, so the UI gate
  and the server gate can import the same constant. Do that — a UI gate spelled as
  `can(role, 'user.edit')` while the action checks a list will drift.

**⛔ Two conjunctions that must not be simplified:**
- Staff-profile "Assign Course" = `STAFF_PROFILE_ACTOR_ROLES` **AND**
  `assignment.create`. `clinicalDirector` holds all four `assignment.*` verbs, so a
  bare verb check surfaces a mutating affordance on a profile the matrix makes
  view-only. Guarded by `tests/e2e/rbac-staff-view-only.spec.ts`.
- Course-detail withdraw = `assignment.delete` **AND** the COU-004 org-ownership
  check **AND** `partitionOrgUsersByFacility`. The verb alone is org-wide.

**A verb granted for one path reaches every path that gates on it.** `assignment.delete`
was granted to supervisor for per-staff withdrawal (Rule C), but it ALSO gates the
role-target **narrow** in `setRoleAssignmentTargets` — where an org-wide
`CourseAssignment` reaches the whole organisation. Caught in review and closed in the
same PR with a second, scope-based gate: refuse the narrow when `!facilityScoped`
and `!isOrgWideFacilityRole(role)`.

That guard is the **mirror of the one a few lines above it** — the widen refuses a row
carrying no role-target scope to inherit; the narrow refuses a row whose scope is
wider than the caller's. When you add a scope gate on this action, look for its
opposite number first; the pair is the pattern. And whenever you widen a role's verbs,
`grep` every `can(roleKey, '<verb>')` site before assuming the grant is bounded by the
feature you were asked to build.

See [[gotcha_role_assign_count_vs_reach]] and
[[gotcha_assignment_row_has_no_role_target_scope]].
