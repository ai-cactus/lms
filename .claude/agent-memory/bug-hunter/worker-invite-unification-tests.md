---
name: worker-invite-unification-tests
description: Test coverage and patterns for the fix/worker-invite unified-invite-flow bug fix (createEnrollmentForUser invite branch, enrollInviteCourses, seat-gated enrollUsers; removeStaff enrollment cleanup since reversed to full retention)
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
- `src/app/actions/staff.test.ts` (`removeStaff`): SUPERSEDED. `removeStaff()` no
  longer deletes any enrollments. It retains all training records, including in-flight
  ones, per founder Q23 (`243375f4`). The array-form `$transaction` double
  (`vi.fn((ops) => Promise.all(ops))`) is still the right pattern for array
  transactions.
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

## E2E specs

`tests/e2e/assign-course-invite.spec.ts` exists and runs: admin assigns a course to a
brand-new email → pending invite → accept via `/join/{token}` → course appears in
`/worker/trainings`. `remove-reinvite-clean-slate.spec.ts` was deleted in `243375f4`
and replaced by `tests/e2e/remove-reinvite-retention.spec.ts`, whose behaviour is
inverted: records are retained, not wiped.
