---
name: gotcha-role-assign-count-vs-reach
description: getRoleHolderCounts and assignCourseToRoleTargets are now both facility-scoped and must stay coupled; CourseAssignment still has no facility column so FUTURE role holders enroll org-wide
metadata:
  type: project
---

`getRoleHolderCounts` and `assignCourseToRoleTargets` (both
src/app/actions/enrollment.ts) are facility-scoped as of 2026-08-27 via
`resolveDataFacilityIds` / `staffFacilityWhere`. They must be changed
**together**, always.

**Why:** the count feeds the assign wizard's "this will enroll N workers" and
the mutation is what actually enrolls. Narrowing either alone produces a UI
that promises one number and performs another — the reason the earlier pass
refused to narrow the count on its own while the mutation was still org-wide.

**Remaining gap (needs a schema change, deliberately not done):**
`CourseAssignment` stores `targetRoles` but no facility, so `enrollUserForRoleTargets`
still auto-enrolls FUTURE holders of a targeted role organisation-wide — a
supervisor's role assignment leaks reach over time even though its immediate
enrolment is scoped. Closing it means a facility column on `CourseAssignment`.

**How to apply:** org-wide roles are unaffected — `resolveDataFacilityIds`
returns `null` for them and `staffFacilityWhere(null)` is `{}`. An empty
accessible list yields `{ in: [] }`, i.e. nobody.

See also [[project_facility_scope_one_condition]], [[gotcha_assignment_action_authorization_split]].
