---
name: gotcha-role-assign-count-vs-reach
description: getRoleHolderCounts and assignCourseToRoleTargets are both facility-scoped and must stay coupled; CourseAssignment's facilityScoped/facilityIds now carry that scope to FUTURE role holders too
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

**Future holders — closed:** `CourseAssignment` now carries
`facilityScoped` + `facilityIds` (`prisma/course.prisma`), and
`enrollUserForRoleTargets` (`src/lib/enrollment/role-targets.ts`) applies them when
auto-enrolling FUTURE holders of a targeted role, so a facility-bound assigner's
reach no longer widens over time. See [[gotcha_assignment_row_has_no_role_target_scope]]
for the row-scope rules that go with it.

**How to apply:** org-wide roles are unaffected — `resolveDataFacilityIds`
returns `null` for them and `staffFacilityWhere(null)` is `{}`. An empty
accessible list yields `{ in: [] }`, i.e. nobody.

See also [[project_facility_scope_one_condition]], [[gotcha_assignment_action_authorization_split]].
