---
name: dashboard-two-actions-one-population
description: getDashboardData, getGlobalDashboardData and the Status Tracker share ONE population (lib/dashboard/scope.ts) and ONE definition per metric (lib/dashboard/definitions.ts); ROLE narrows nothing, facility narrows by CURRENT roster only, and dropping the member org pin causes cross-tenant inflation
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

**Since PR-B (2026-09-27)** the views also share their MATHS: one snapshot
(`lib/dashboard/snapshot.ts`, fixed query set) counted by
`lib/dashboard/definitions.ts`; a Global facility row and `getDashboardData([id])`
read the same `sliceSnapshot(snapshot, [id])`. Facility attribution is the
member's CURRENT active roster — never `Enrollment.facilityId` (BUG-36).

**The second axis (BUG-01, fixed 2026-09-24):** the bundle's `courseWhere` was
built from `authoredCourseWhere`, so the one manager role without `course.read`
— **finance** — got `{ createdByOrgUserId }` and read 2 courses where its Owner
read 4, with every enrolment-derived tile disagreeing too. `authoredCourseWhere`
is gone (the dashboard was its last caller); `courseWhere` is now
`orgCourseWhere(organizationId)` for everyone. The line to hold: **role narrows
nothing in this bundle, facility narrows only the member side (roster)**
(courses are org-global, so facility never touches `courseWhere`). What a role
may SEE is the CALLER's decision — `getDashboardData` strips `courses` and
`coursePerformance` on `canViewOrgCourses`, which is the SAME predicate the old
population branch used, so widening the population exposed nothing new.
Verify a claim like "only finance is affected" by enumerating `ALL_ROLES` in a
throwaway `npx tsx` script; only 6 roles pass the action's
`assignment.read || billing.read` gate at all.

**How to apply:**
- Every enrollment predicate on either dashboard MUST carry
  `organizationUser: { organizationId }`. `OrgCourseOffering` links a course to
  ANY organisation, so a course-only predicate counts another tenant's learners
  on an adopted course. The failure mode is a bigger, plausible-looking number.
- `getCourses`' own `ownCounts` groupBy (`course.ts`) now carries that pin too
  (`organizationUser: { organizationId }` beside `course: authoredWhere`) — keep it.
- `FacilityOverviewRow` carries `activeLearners`/`activeCourses`/`averageGrade`
  (not rendered) so the parity suite can compare a row to that facility's view.
- Comparison headlines are counted server-side (`getGlobalDashboardData({
  compareFacilityIds })`), never summed from rows — summing double-counts a
  two-facility member.

See also [[project_facility_scope_one_condition]],
[[gotcha_role_assign_count_vs_reach]].
