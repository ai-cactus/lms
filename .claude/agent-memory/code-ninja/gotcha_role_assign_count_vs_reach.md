---
name: gotcha-role-assign-count-vs-reach
description: Don't facility-scope getRoleHolderCounts while assignCourseToRoleTargets still enrolls org-wide — the wizard would understate what the assignment does
metadata:
  type: project
---

`getRoleHolderCounts` (src/app/actions/enrollment.ts) and the mutation behind
`assignCourseToRoles` — `assignCourseToRoleTargets`, same file — must be
narrowed together or not at all. The count feeds the assign wizard's "this will
enroll N workers"; the mutation enrolls `organizationUser.findMany({ organizationId, role: { in: targetRoles }, active: true })`,
which is org-wide with no facility predicate.

**Why:** during the 2026-08-27 facility read-scoping pass, item 6 of the brief
proposed facility-scoping the count. Narrowing only the read would make a
supervisor's wizard promise 3 enrolments and perform 40 — worse than the
current honest-but-broad number. Left unchanged and flagged instead.

**How to apply:** the real defect is on the mutation (a facility-bound role
assigning by role reaches every facility). Fix that first, in the same change
as the count. Until then treat the org-wide count as deliberate.

See also [[project_facility_scope_one_condition]].
