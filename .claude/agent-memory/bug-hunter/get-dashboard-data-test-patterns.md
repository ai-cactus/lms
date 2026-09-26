---
name: get-dashboard-data-test-patterns
description: How to mock the dashboard snapshot (getDashboardData / getGlobalDashboardData / status tracker) — six findMany reads, the two course.findMany calls told apart by the published filter
metadata:
  type: project
---

Since PR-B (`feature/dashboard-metric-definitions`, 2026-09-27) every dashboard
figure is counted in memory by `src/lib/dashboard/definitions.ts` over one
snapshot loaded by `src/lib/dashboard/snapshot.ts`. There are no
`enrollment.groupBy` / `aggregate` / `count` reads left on either dashboard
action, and `monthlyPerformance` / `organisationTotals` are gone.

## What a mocked Prisma must provide

`loadDashboardSnapshot` issues, in one `Promise.all`: `organizationUser.findMany`
(population, with `facilities: [{ facilityId }]`), `enrollment.findMany`,
`quizAttempt.findMany` (`where.enrollment` = the enrolment predicate),
`certificate.findMany` (rows carry `enrollment.assignment.renewalCycle`),
`course.findMany` (published ids) and `quiz.findMany`. `getDashboardData` adds a
SECOND `course.findMany` (the catalogue). Route the two by
`args.where.status === 'published'`, not call order — see `wireSnapshot` in
`course.test.ts` / `dashboard-facility.test.ts`. The Global action also calls
`organizationUser.count` (previous staff for the trend) and `facility.count`.
`resolveDashboardScope` still needs `orgCourseOffering.findMany`.

## Numeric parity: use a predicate-aware fake

`dashboard-parity.test.ts` evaluates the member/roster/role/due/status predicates
the shared scope emits over one fixture, so the numbers come from the same
predicates production sends. The in-memory slicing also narrows by
`dataFacilityIds`, so a mock that returns a superset still yields correct
per-facility figures — assert on the where-clauses to prove the SQL narrows too.

## Gotchas
- The Status Tracker's `enrollment.findMany` selects a display row
  (`select.assignment` present); the snapshot's does not — branch on that when
  one fake serves both.
- A snapshot enrolment row needs `startedAt` (dormancy reads it); omitting it
  crashes the Global headline, not the facility view.

See [[dashboard-single-facility-scope-tests]].
