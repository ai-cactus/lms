---
name: sweep-test-mock-queue-coupling
description: One change to sweep.ts's role pre-pass reddens 13 unrelated sweep tests, because every test shares one mockResolvedValueOnce queue on enrollment.findMany
metadata:
  type: feedback
---

`src/lib/reminders/sweep.test.ts` queues `prismaMock.enrollment.findMany` with
ordered `mockResolvedValueOnce(...)` calls — one per pre-pass, in the order
`runReminderSweep` runs them (role-target reconcile, then Track A, then Track B).
If a pre-pass aborts EARLY it never consumes its slot, so every later fixture in
that test shifts by one and the failure surfaces in a completely different
`describe` (renewal, dispatch tallies) with a plausible-looking wrong value
rather than a mock error.

The role pre-pass swallows its own errors (best-effort backstop), so the abort is
silent: `wireCourseAssignmentFindMany` routes `courseAssignment.findMany` by
inspecting `args.where` keys and THROWS on an unrecognised shape — change the
pre-pass's `where` and you get 13 red tests, none of which name the real cause.

**Why:** hit while widening the role pre-pass's `where` to an `OR` (the singular
`targetRole` ∪ the plural `targetRoles`). Diagnosis cost more than the change.

**How to apply:** when editing any query inside a `sweep.ts` pre-pass, update
`wireCourseAssignmentFindMany`'s routing and the `makeRoleTargetAssignment`
fixture in the same edit — the fixture must carry every column the new `select`
asks for, or `undefined` leaks into an `expect.objectContaining({ x: null })`.
A broad red result there is almost never 13 real regressions. See
[[targetroles-backfill-is-provable]].
