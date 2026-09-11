---
name: gotcha-assignment-row-has-no-role-target-scope
description: A CourseAssignment created by an INDIVIDUAL assignment records no facility scope, so its stored reach cannot be inherited by a later role-target widen
metadata:
  type: project
---

`CourseAssignment.facilityScoped` / `facilityIds` are written **only** by the
role-target path (`assignCourseToRoleTargets` → `upsertCourseAssignment({ facilityScope })`).
`enrollUsers` passes `facilityScope: undefined`, which `facilityScopeColumns`
turns into `{}` — the row keeps the column default `facilityScoped: false`, and
`assignmentFacilityScope()` decodes that as **org-wide**.

There is one row per `(organizationId, courseId)`, so the row an individual
assignment created is the same row a later role targeting would edit.

**Why:** it means "inherit the row's recorded scope" — the rule that stops a
widen from re-widening what a facility-bound assigner narrowed — is only sound
for a row that already HAS role targets. Applied to a never-role-targeted row it
inherits org-wide and hands a supervisor the whole organisation.

**How to apply:** any in-place edit of an assignment's `targetRoles` must refuse
a widen when the row's current `targetRoles` is empty, and send the caller
through `assignCourseToRoles` instead — that path resolves
`resolveDataFacilityIds(session)` and records the caller's own reach.
`setRoleAssignmentTargets` and `RoleTargetPicker`'s live/draft mode switch both
enforce this; keep them in step. See also
[[gotcha_role_assign_count_vs_reach]] and [[org_facility_split]].
