---
name: facility-scope-and-switching-tests
description: Test suite added for the facility-scope-and-switching PR (D-01's "verbs gated, reads not" fix) — files, patterns, and the one real gap left
metadata:
  type: project
---

Branch `feature/facility-scope-and-switching` (~15 fix commits) closed D-01's
facility-scope gap: `isAdminRole()` admits `supervisor`, who is facility-bound,
so mutations were narrowed but reads were not — worst case, `getCourseForOrgView`
had NO role gate at all (any authenticated member, worker included, could read
every enrollee's PII). 19 test commits were added on top, all green:
`npx vitest run src/app/actions src/app/dashboard src/components/dashboard src/lib`
→ 199 files / 3330 tests (baseline was 188/3190). `npm run typecheck` and
`npm run lint` both clean (lint: 0 errors, 14 pre-existing warnings, none new).

**Why:** this PR's own governing rule — org-wide/multi-facility roles may
switch/filter by facility; a facility-bound role must never see or switch to
global/org-wide data — makes "fail-closed" (empty facility list = nobody, never
everybody) the load-bearing invariant tested everywhere: `staff-where.ts`,
`assignment-facility-scope.ts`, `status-tracker.ts`'s `facilityId` param,
`getDashboardData`, `getCourses`' enrollment tallies, `assignCourseToRoles`/
`getRoleHolderCounts`, `getAdminWorkerCertificates`.

**How to apply:** when this branch (or its dev-line successor) gets touched
again, these are the files to extend rather than re-derive from scratch:
- `src/lib/course/access-error.test.ts`, `load-course-detail.test.ts` — the
  typed `CourseAccessError` / retry-only-on-access-error contract.
- `src/lib/facility/staff-where.test.ts` — the `string[] | null` fail-closed
  contract used everywhere else.
- `src/lib/enrollment/assignment-facility-scope.test.ts`,
  `assignment.facility-scope.test.ts` — encode/decode + the `undefined` (leave
  untouched) vs `null` (org-wide) vs `[]` (narrowed to nobody) distinction on
  `upsertCourseAssignment`'s `facilityScope` param — a genuinely confusable API.
- `src/app/actions/course.test.ts` (`describe('getCourseForOrgView', ...)`) —
  the PII-leak fix; asserts roster **contents** (emails), not just call status.
- `src/app/actions/enrollment.role-target-facility-scope.test.ts`,
  `src/lib/enrollment/role-targets.test.ts`, `src/lib/reminders/sweep.test.ts`
  (`facilityScoped assignments` describe blocks) — the live auto-enroll hook
  and nightly backstop must apply the SAME scope, or the backstop re-widens
  nightly what the live hook narrowed.
- `src/app/dashboard/(main)/page.test.tsx`, `layout.test.tsx` (new file) — the
  `globalData.facilities.length > 1` branch and the two leaks it opened
  (`getDashboardData(undefined)`, `getStatusTrackerSummaryForOrg(..., undefined)`)
  for a single-facility-bound viewer reaching the classic-dashboard branch for
  the first time.
- `src/components/dashboard/FacilityScopeSwitcher.test.tsx`,
  `staff/StaffListClient.test.tsx`, `StaffProfileClient.change-facility.test.tsx`
  — QA #21: every existing fixture had already been bumped to 2 facilities to
  keep old tests green, but NONE of them had a dedicated exactly-1-facility
  case exercising the actual `>1` regression. Always add that case explicitly
  when a fixture bump alone would make a real regression invisible.

**Known pinned (not bugs):** Finance lost `course.read` 2026-08-25 so can no
longer open a global course's detail page; Clinical Director holds
`course.read` but not `user.read` so gets a self-only roster from
`getCourseForOrgView`.

**Left undone:** no new Playwright e2e spec for the facility-switcher UI flow
— e2e cannot run in this sandbox (no `@next/swc` bindings) and the unit/action
layer already covers every fail-closed path exhaustively; a live
`tests/e2e/facility-scope-switching.spec.ts` would still be worth writing in a
sandbox where e2e is runnable. See [WSL2 Playwright browser
install](wsl2-playwright-browser-install.md) and [Local production-build e2e
run recipe](local-production-build-e2e-run.md) for how to get e2e running
locally if picked up later.
