---
name: dashboard-two-actions-one-population
description: getDashboardData and getGlobalDashboardData must share a POPULATION (lib/dashboard/scope.ts) but not queries; widening a course predicate there without the member org pin causes cross-tenant inflation
metadata:
  type: project
---

`/dashboard` picks its DATA SOURCE by facility count: `> 1` accessible facilities
→ `getGlobalDashboardData`, otherwise the legacy inline dashboard fed by
`getDashboardData`. Until 2026-09-14 the legacy branch counted only courses the
VIEWER had authored, so a single-facility owner saw near-zero while a
two-facility owner saw the organisation. Third recurrence of the class
(`getCourses` and `enrollUsers` were each widened for it and this action missed
both times), which is why the fix is a predicate bundle —
`src/lib/dashboard/scope.ts` — rather than a corrected query.

**Why:** the two actions legitimately count DIFFERENT things, so sharing their
aggregates would be wrong; sharing what they count OVER is not optional. Bake
`courseWhere` into the shared `enrollmentWhere` and the global dashboard collapses
to one author's courses for any non-manager caller — keep it per-aggregate.

**How to apply:**
- Every enrollment predicate on either dashboard MUST carry
  `organizationUser: { organizationId }`. `OrgCourseOffering` links a course to
  ANY organisation, so a course-only predicate counts another tenant's learners
  on an adopted course. The failure mode is a bigger, plausible-looking number.
- `getCourses`' own `ownCounts` groupBy (`course.ts`, `where: { course:
  authoredWhere, ... }`) still lacks that pin — known, deliberately unfixed.
- `GlobalDashboardData.organisationTotals` is not rendered; it exists so
  cross-action parity is testable at all (the two views share no visible number).

See also [[project_facility_scope_one_condition]],
[[gotcha_role_assign_count_vs_reach]].
