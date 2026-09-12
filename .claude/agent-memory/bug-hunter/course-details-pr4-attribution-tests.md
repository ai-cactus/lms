---
name: course-details-pr4-attribution-tests
description: PR-4 course-creation-flow-redesign — mayReviewWithoutEnrollment per-role table, D10 attribution display-name trap, e2e cleanup/rendering gotchas
metadata:
  type: project
---

Tested PR-4 (course-details hero + D5/D7/D8/D10) on `feature/course-details-page`,
`src/components/dashboard/training/TrainingDetails.tsx` +
`src/lib/learn/get-learn-payload.ts`. All green: unit/component 1268 tests /
77 files (training+learn+api+course-action suites combined), e2e 3/3. No
product bug found — everything code-ninja shipped behaved as specced.

**Why:** capture the non-obvious traps that cost real debugging time so the
next round on this page (or similar attribution/RBAC work) doesn't re-hit them.

**How to apply:**

- `getRoleDisplayName()` returns the FULL registry `displayName`, not a
  shortened label — `'owner'` → `"Owner (Organisation Admin)"`,
  `'supervisor'` → `"Facility Supervisor"`, not `"Owner"`/`"Supervisor"`. Any
  test asserting an attribution/role-label string (D10's "Approved by: X
  (role)" line, invite dropdowns, etc.) must use the exact registry string —
  grep `src/lib/rbac/permissions.ts`'s `roles` map rather than guessing.

- `mayReviewWithoutEnrollment(role) = isAdminRole(role) && can(roleKey,
  'course.read')` in get-learn-payload.ts is the fix for team QA #9
  (finance lost course.read 2026-08-25 but could still open `/learn/{id}` by
  URL). The per-role table is worth re-running any time this predicate or
  `workerPermissions` changes: `course.read` sits in `workerPermissions`, so
  13/14 roles hold it — a bare `can(role, 'course.read')` gate would ADMIT
  EVERY WORKER, the opposite of the fix. Test BOTH call sites
  (admin-session fallback AND the `enterLearnMode`/worker-session fallback)
  since `enterLearnMode` mints a worker cookie carrying the manager's REAL
  role (session-bridge.ts) — a fix applied only to the admin branch leaves
  that path exposed. See `src/lib/learn/get-learn-payload.test.ts`'s
  "per-role admission table" describe block for the full 14-role matrix.

- **E2E cleanup: never `DELETE ... WHERE email LIKE '%<shared-suffix>'`**
  when multiple tests in the same spec file share an email-domain suffix
  (the usual `uid('prefix')` pattern) and run under Playwright's default
  concurrent workers. One test's cleanup will delete ANOTHER still-running
  test's users mid-flight, surfacing as a spurious
  `violates foreign key constraint ... on table courses` error that looks
  like a product bug but is a test-fixture race. Delete by exact captured
  id instead (own the reviewer/creator ids in the `Seeded` interface, don't
  rely on a wildcard sweep).

- `/learn/{id}` for an admin/manager viewing a course with ZERO lessons and
  no lesson-level content renders straight into the admin quiz editor
  (`AdminQuizEditor`, "Edit Quiz Questions") rather than any course-title
  heading — `isQuizIndex` is trivially true when `course.lessons.length ===
  0`. Don't assert on course-title text after a "View Course" click for a
  lessons-empty e2e fixture; assert on the URL instead (which is also the
  actual regression shape being guarded — same class of bug as the
  [[free-module-navigation-tests]] "Go Back" href fix from commit b88331f
  that morning).

- `TrainingDetails` test fixtures (`baseCourse` helper) MUST set
  `creator: { role, user: {...} }` and `approvedBy: null | {...}` since D10 —
  omitting either throws before the hero renders. When a fixture needs
  populated `lessons`/`quiz` overrides (not just `[]`/`null`), type the
  helper's `overrides` param as `Record<string, unknown>`, not
  `Partial<CourseWithRelations>` — the latter forces every nested lesson/quiz
  object to satisfy the FULL Prisma-derived shape (all of `order`,
  `videoDurationSeconds`, `questions`, etc.), not just the fields the
  component reads.
