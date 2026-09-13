---
name: assign-role-label-due-date-tests
description: AssignPublishClient's first-ever unit test file + sweep.ts absolute-dueAt/multi-role coverage for the "Due Date belongs in both modes" fix (2026-09-12); the toggle button text is now "Roles", not "A whole role"
metadata:
  type: project
---

**Context**: `AssignPublishClient.tsx` hid the Due Date field in role mode on a
false comment ("role targets never carry an absolute due date"). The fix made
Due Date render in both modes, renamed the role-toggle button `'A whole role'`
→ `'Roles'`, and had both `assignCourseToRoles` (role branch, field `dueDate`)
and `enrollUsers` (people branch, field `dueAt`) round-trip `dueWindowDays` from
`existingSettings` so re-submitting from `/assign` can't silently null a window
the course wizard set (both actions write that column unconditionally).
`sweep.ts`'s nightly role-target reconcile pre-pass got the matching backstop
fix: honour `assignment.dueAt` when present (previously hard-coded `null`), and
enrol holders of **every** targeted role via `targetRoles`, not just the
deprecated singular `targetRole` (roles 2..N of a multi-role assignment had no
backstop before).

**AssignPublishClient had zero unit tests before this** — the structural gap
that let the asymmetry ship unnoticed. New file:
`src/components/dashboard/training/AssignPublishClient.test.tsx` (10 tests).
Mocking pattern that worked: `vi.mock('@/components/ui/DatePicker', ...)`
swapping in a plain `<input>` (must set BOTH `aria-label` and `placeholder` —
setting only `aria-label` breaks `getByPlaceholderText` since the mock doesn't
otherwise carry the attribute), `vi.mock('@/components/dashboard/enrollment/RoleTargetPicker', ...)`
as a stub button that fires `onSelectionChange(['nurse'])` on click (mirrors
[[rbac-sidebar-module-gating-tests]]'s stub style), and asserting each submit
call's 3rd positional arg (`enrollUsers(courseId, entries, settings)` /
`assignCourseToRoles(courseId, roles, settings)`) with `objectContaining` plus
`not.toHaveProperty('dueDate'|'dueAt')` to pin the two actions to their
distinct field names.

**Gotcha**: `getByRole(role, { name, exact: true })` — `exact` is NOT a valid
`ByRoleOptions` key in this repo's installed `@testing-library/dom` version
(tsc: "Object literal may only specify known properties, and 'exact' does not
exist in type 'ByRoleOptions'"). It's valid for Playwright's `page.getByRole`
(used correctly in the e2e specs) but not RTL's `screen.getByRole` here — the
`name` string already matches exactly by default in RTL, so just drop the flag
in unit tests. Don't copy the e2e locator's `exact: true` verbatim into an RTL
assertion.

**sweep.test.ts**: added 2 tests to the existing role-target reconcile pre-pass
describe block — one absolute-`dueAt`-wins case, one second-targeted-role
(`targetRoles: ['nurse', 'therapist_clinician']`) case. Followed the "prove it
fails first" discipline: `git stash push -- src/lib/reminders/sweep.ts` (kept
the already-updated sweep.test.ts, which needed no fixture changes beyond what
the person who wrote the product fix already added — `dueAt` field + `OR`
where-routing in `wireCourseAssignmentFindMany`) reverted product code to the
pre-fix version; both new tests failed with the exact expected diff (`dueAt`
ignored → `assignmentDueAt: null`; only the first role's holder enrolled), the
other 49 tests in the file were unaffected; `git stash pop` restored the fix,
all 51 passed. Confirms the tests are load-bearing, not vacuous.

**e2e**: `reminders.spec.ts` (9 tests, 1 pre-existing skip —
`PLAYWRIGHT_SYSTEM_ADMIN_COOKIE` not set, unrelated) and
`course-role-assignment.spec.ts` (1 test) both green after the toggle-button
rename to `'Roles'` and the reminders.spec.ts:377 assertion flip
(`.not.toBeVisible()` → `.toBeVisible()` for the Due Date heading in role
mode). See [[role-target-picker-stale-locator-sweep]] for the now-corrected
stale-recipe note. `npm run e2e:local -- reminders.spec.ts
course-role-assignment.spec.ts` runs both files' tests together correctly
(positional args are additive per-file, not a single combined filter) — total
test count across two files sums as expected (9 + 1 = 10), don't be alarmed by
a single low "N tests" figure without checking `--list` first.

**Full changed-scope regression**: `npm run test:changed` — 563 tests, all
green, no incidental breakage from the round-trip `dueWindowDays` change
touching both `enrollUsers` and `assignCourseToRoles` call sites.
