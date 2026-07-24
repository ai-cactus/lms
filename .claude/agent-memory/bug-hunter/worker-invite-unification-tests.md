---
name: worker-invite-unification-tests
description: Test coverage and patterns for the fix/worker-invite unified-invite-flow bug fix (createEnrollmentForUser invite branch, enrollInviteCourses, seat-gated enrollUsers, removeStaff enrollment cleanup)
metadata:
  type: project
---

Branch `fix/worker-invite` replaced "assign course to an unknown email → create
account + temp password" with "assign course to an unknown/org-less email →
send a `/join/{token}` invite with the course parked on it
(`InviteCourseAssignment`, new model), materialised into a real enrollment at
accept time". Full coverage added/rewritten 2026-07-24:

- `src/lib/enrollment/create.test.ts` — full rewrite of the invite branch
  (create vs reuse-and-refresh-expiry, CSV role mapping, ctx.organizationId
  null → failed, email-send failure isolation, DB-failure isolation) plus the
  pre-existing cross-tenant/idempotency/existing-member tests updated for the
  new `'invited'` outcome status (was `'newInvited'` with userId/enrollmentId).
- `src/lib/enrollment/invite-courses.test.ts` — new file for
  `enrollInviteCourses`; mocks `createEnrollmentForUser` entirely (isolates
  this module's own responsibility: resolving live `CourseAssignment`
  settings or falling back to bare nulls, building the enrollment ctx, never
  throwing) rather than re-testing `createEnrollmentForUser`'s internals.
- `src/app/api/invite/accept/route.test.ts` and
  `src/lib/create-auth-instance.test.ts` — both accept paths (credentials
  route, OAuth new-user branch, OAuth org-less-relink branch) now assert
  `enrollInviteCourses(userId, inviteId)` is called AFTER
  `enrollUserForRoleTargets`, via `mock.invocationCallOrder`. The OAuth signIn
  callback's pendingInvite branches had ZERO prior test coverage — this is a
  brand-new describe block, not an update.
- `src/app/actions/staff.test.ts` (`removeStaff`) — `$transaction` is now the
  Prisma **array form** (`prisma.$transaction([...])`, not a callback), so the
  test double is `vi.fn((ops) => Promise.all(ops))` — the individual delegate
  calls (`enrollment.deleteMany`, `user.update`, `invite.updateMany`) are
  already-invoked mock promises by the time the array reaches `$transaction`,
  matching real Prisma array-transaction semantics closely enough for a unit
  double. New tests cover: only active-status enrollments deleted (terminal
  ones retained by omission from the filter, not by an explicit "keep" list),
  pending invites expired (not deleted), and `droppedEnrollmentCount` on the
  audit metadata.
- `src/app/actions/enrollment.test.ts` / `enrollment.assignment.test.ts` — both
  needed a NEW `organization.findUnique` prisma-mock default (`null`), because
  `enrollUsers` now unconditionally calls `getSeatUsage(organizationId, ...)`
  when the caller has an org; resolving `null` makes `getSeatUsage` return
  `staffMax: null` (a no-op), so pre-existing tests not focused on the seat
  gate need no further mocking. A new "unified invite flow" describe in
  `enrollment.test.ts` covers: overflow emails rejected into `failed` without
  creating an invite, existing members/pending invites NOT consuming a new
  seat, and `'invited'` mapping into the `newInvited` result bucket (client
  contract unchanged).
- `src/app/actions/invite.test.ts` — added a regression test that resending a
  pending invite refreshes `expiresAt` (`prisma.invite.update` call added
  alongside the existing resend-email assertion); required adding
  `invite.update` to the file's prisma mock (wasn't there before).

## New gotcha instance: unconsumed `mockResolvedValueOnce` leaking across tests

Hit again in `enrollment.test.ts`'s new seat-gate tests — same root cause
already documented in [[phase2-fix-round-test-patterns]]'s sweep-pre-pass
section: `vi.clearAllMocks()` in `beforeEach` does NOT clear a queued
`mockResolvedValueOnce` value that a PRIOR test left unconsumed (only
`mockReset()`/`resetAllMocks()` does). Concretely: a "seat-rejected entry"
test queued `.mockResolvedValueOnce(adminUser).mockResolvedValueOnce(null)` on
`prisma.user.findUnique`, but the seat-rejected entry `continue`s straight to
`failed` BEFORE `createEnrollmentForUser` ever makes its own
`user.findUnique` call — so the second queued value was never consumed, and
leaked into the NEXT test as its FIRST value (shifting `currentUser` to
`null` and throwing `Forbidden` instead of reaching the code under test).
Symptom pattern to recognize: a test several positions after the real culprit
fails with a wrong/impossible value, not the test whose fixture is actually
wrong. Fix: only queue exactly as many `mockResolvedValueOnce` values as the
code path under test will actually consume — trace the call count for the
SPECIFIC branch/outcome each test exercises, not the "happy path" call count.

Related: [[phase2-fix-round-test-patterns]], [[join-invite-critical-fix-regression]].

## Environment: could not execute e2e specs or apply the new migration

DB (`localhost:5433`) unreachable and Docker unusable from this WSL2 shell (no
`docker.sock`, no `docker` binary on the Linux `$PATH` — only the Windows-side
Docker Desktop binary is visible under `/mnt/c/...`, not invocable here). Two
new specs were written and validated with `npx playwright test --list` (parses
cleanly, both tests enumerate) but never actually run:
`tests/e2e/assign-course-invite.spec.ts` (admin assigns a course to a brand-new
email → pending invite visible on the assign page → accept via `/join/{token}`
→ worker logs in → course appears in `/worker/trainings`) and
`tests/e2e/remove-reinvite-clean-slate.spec.ts` (worker with one in-flight +
one completed enrollment is removed → in-flight enrollment dropped, completed
retained → re-invited → accepts → Trainings list shows the clean slate). The
migration `20260724120000_add_invite_course_assignments` was also never
applied to any DB in this session — whoever runs these next must
`prisma migrate deploy` first.
