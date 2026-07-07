---
name: get-dashboard-data-test-patterns
description: Mocking approach for getDashboardData's dual enrollment.groupBy calls and the "failed" status quirk in training-coverage classification
metadata:
  type: project
---

`src/app/actions/course.test.ts` (new, feat/audit-fx) covers `getDashboardData`
in `src/app/actions/course.ts`, added after F-028 replaced a full
`enrollments: true` materialization with `enrollment.groupBy` aggregations +
a narrow scored-enrollment `findMany`.

## Dual groupBy calls need branch-by-args mocking, not call-order mocking

`getDashboardData` calls `prisma.enrollment.groupBy` twice inside the same
`Promise.all` — once `by: ['courseId','status']` (per-course tallies) and
once `by: ['userId','status']` (training-coverage tallies). Both hit the same
mock fn. Don't rely on `mockResolvedValueOnce` call order (fragile against
reordering the `Promise.all` array) — instead give `mockImplementation` a
single function that inspects `args.by.includes('courseId')` vs
`.includes('userId')` and returns the matching fixture. See the `wireGroupBy`
helper in the test file.

## Not a bug, but surprising: `status: 'failed'` enrollments count as "not started" in training coverage

The per-user classification in `getDashboardData` only special-cases
`completed`/`attested` → hasCompleted and `in_progress` → hasInProgress;
everything else (including `failed`, not just `enrolled`/`assigned`) falls
into the `else` branch and is treated as `hasNotStarted`. This is current,
intentional-looking behavior (comment says "'enrolled' / 'assigned'" but the
code doesn't actually exclude `failed`) — documented in the test fixture (u6)
rather than flagged as a bug, since it's plausibly intentional ("still needs
to complete training") and pre-dates the F-028 refactor (same logic, just
fed by groupBy now instead of a materialized array).

## `trainingCoverage.totalStaff` is distinct enrolled staff, not org headcount

`trainingCoverage.totalStaff` = `totalStaffAssigned` (size of the per-user
enrollment map), NOT `totalOrgStaff` (the `prisma.user.count` org headcount
used as the percentage denominator). The two numbers can differ (staff with
zero enrollments count toward `notStarted` and toward the `totalOrgStaff`
denominator, but not toward `totalStaffAssigned`). Easy to accidentally
assert the wrong one — pin both explicitly.

## Fake timers required for monthlyPerformance, but derive labels rather than hardcode

`monthlyPerformance` builds 12 trailing calendar months from `new Date()` via
`toLocaleString('default', { month: 'short' })`. Use `vi.setSystemTime` at a
fixed **local noon** (avoids the DST/midnight edge from
[[reminders-test-patterns]]) and derive expected month labels the same way
(`new Date(year, month, 1).toLocaleString('default', {month:'short'})`)
instead of hardcoding `'Mar'`/`'Apr'` strings, so the assertion isn't
locale-dependent.

## Regression guard for the F-028 perf fix

Added a dedicated test asserting: `enrollment.groupBy` called exactly twice
(with the two expected `by` shapes), `course.findMany`'s args have no
`include` and no `select.enrollments`, and `enrollment.findMany` is called
with the exact narrow `{ courseId, score, completedAt }` select — pins the
query shape itself so a future edit can't silently reintroduce the full
`enrollments: true` materialization while still passing the value-based
assertions.

No product bugs found; all hand-computed expected values (per-course
completion rate, overall/per-course average grade at the passing-score
boundary, Hamilton-rounded coverage percentages) matched actual output on
first run — 668/668 suite green after adding 4 new tests.
