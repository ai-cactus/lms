---
name: reminder-ladder-consolidation-phase5-tests
description: Phase 5 of assign-surface consolidation (D-B — wizard's "N days before" vocabulary made canonical, per-stage advanced editor removed) — sink-safety integration test technique, it.each array-spread trap, ReminderLadderInput/AssignPublishClient coverage
metadata:
  type: project
---

**Context**: `feature/assign-reminder-ladder` retired `AssignPublishClient`'s 6-stage
signed-offset "Advanced reminder schedule" editor in favor of the wizard's
≤3-row "remind N days before" vocabulary (new `ReminderLadderInput.tsx` +
`src/lib/enrollment/reminder-ladder.ts`, with the new inverse
`stageRowsToReminderDays()`). See [[assign-consolidation-phase1-tests]],
[[assign-role-label-due-date-tests]], [[assign-deadline-time-phase4-tests]] for
the preceding phases this builds on, and [[role-target-picker-stale-locator-sweep]]
for why CLAUDE.md now has a standing "grep tests/e2e before removing a UI
control" rule (PR #595/#600 precedent) — this phase is a clean example of
following it: the removed advanced editor had **no e2e coverage at all**
(confirmed by grep), so there was no stale spec to fix, only a gap to fill.

**Sink-safety integration test technique (Priority 1 — proving an org's custom
GRACE_SOFT_ESCALATION/HARD_ESCALATION offsets survive a wizard-vocabulary
save)**: rather than asserting on `mockStageUpsert`'s call args (which only
proves what was SENT, not what SURVIVES), built a stateful fake Prisma double —
a `Map<ReminderStage, StoredStage>` that `assignmentReminderStage.upsert`'s
mock actually writes into, keyed by `where.assignmentId_stage.stage` — seeded
with a pre-existing full ladder including custom escalation offsets, then ran
the REAL `resolveStageRows({ reminderDaysBefore: [...] })` →
`upsertCourseAssignment({ stageRows })` composition and read the map back
afterward. This is strictly stronger than the existing call-args-only pattern
in `assignment.settings-tri-state.test.ts` for this specific claim ("survives"
implies "was never touched", which a stateful double can actually witness).
New file: `src/lib/enrollment/assignment.reminder-ladder-sink-safety.test.ts`.

**Red-then-green sabotage for Priority 1, done via a real (reverted) source
edit rather than a synthetic bad-input test**: temporarily appended two
escalation-stage entries (at their `REMINDER_STAGE_DEFAULTS` canonical offset)
to `reminderDaysToStageRows`'s return array in `assignment.ts` — reproducing
the exact pre-#607 bug the phase's own docblock describes. All 3 sink-safety
tests went red, plus 2 pre-existing tests in `assignment.reminder-stages.test.ts`
(confirming those already guard the OUTBOUND direction of this same bug).
Restored via a scratchpad backup (`cp` before editing) and confirmed
`git diff --stat` matched the original uncommitted diff exactly before
re-running to confirm green. Prefer this real-sabotage approach over a
hand-built "bad stageRows list" positive control when the product function
itself is what you're threat-modeling — a synthetic control only proves the
double CAN detect a wipe, not that YOUR test would catch a regression in the
actual code path.

**`it.each` array-spread trap, hit twice in one file**: passing an array of
arrays directly to `it.each` — e.g. `it.each(validDayLists)` where
`validDayLists: number[][]` — spreads each inner array's OWN elements as
positional test-function arguments, not as one argument holding the array.
For a callback declared `(days) => …`, a day-list of length 0 binds
`days = undefined`, length 1 binds `days` to the bare number, and length 2+
silently drops everything past the first element. This passed for zero
elements (30-ish false negatives... no — it flat-out crashed with
`daysBefore.filter is not a function` on non-empty single-element lists, and
silently mis-bound on longer ones) rather than silently passing, which is what
made it easy to catch: **wrap each item in a further array** —
`it.each(validDayLists.map((d) => [d]))` — whenever the table itself is
naturally an array of arrays but the callback should receive ONE argument that
IS an array.

**Property-style round-trip sweep**: `stageRowsToReminderDays(reminderDaysToStageRows(d)) === d`
tested over every subset of size 0-3 from a 13-value candidate pool
(`[0,1,2,3,5,7,10,14,21,30,45,60,90]`), sorted descending to match the
canonical shape — 302 generated cases via a small recursive `combinations()`
helper, all pure-function calls so it runs in well under a second. Chosen over
a fuzzing library per the orchestrator's own steer ("a property-style test is
better here than three examples") without adding a new dependency. Separately,
a **hydrate → submit round trip** (`reminderDaysToStageRows(stageRowsToReminderDays(stored)) === stored`
for `stored` itself produced by `reminderDaysToStageRows`) proves the "no-op
re-save changes nothing" guarantee — this is NOT the same invariant as the
day-list round trip, because `reminderDaysToStageRows` reassigns days-to-stage
purely by POSITION after sorting, not by original stage identity, so it only
holds starting from an already-canonical stored shape (which is the only shape
this vocabulary ever actually produces).

**`ReminderLadderInput.test.tsx`** (new, Priority 3): needed the same jsdom
Radix-Select stubs (`ResizeObserverStub`, `hasPointerCapture`/
`setPointerCapture`/`releasePointerCapture`/`scrollIntoView`) as
`Step7Assign.test.tsx`, since the control renders the same "days" unit
`Select`. Covers `disabled` (neither host's own suite exercises this prop
directly — `Step7Assign` never passes it, `AssignPublishClient` does).

**`AssignPublishClient.test.tsx` Priority 4 gotcha**: a test that tried to
start from `existingSettings({ stages: [] })` and then click "Remove reminder
N" to empty the ladder found there was nothing to remove — `stages: []` on a
non-null `existingSettings` hydrates through `stageRowsToReminderDays([])`
which is ALREADY `[]`, unlike the `existingSettings === null` branch which
uses `DEFAULT_WIZARD_REMINDER_DAYS`. Split into two separate tests: one
confirming the already-empty-on-hydrate case, one confirming the
remove-by-hand case starting from the populated default — they exercise
different code paths (the ternary's two branches) even though both end at the
same submitted `reminderDaysBefore: []`.

**e2e (Priority 5)**: confirmed via grep that neither the new control nor the
removed advanced editor had ANY e2e coverage before this phase. Added
`REM-011` to `tests/e2e/reminders.spec.ts` (the file already runs in
`test.describe.configure({ mode: 'default' })` sequential order and reuses the
same seeded course across tests, so REM-011 reads its ladder's CURRENT values
dynamically via `inputValue()` rather than hardcoding an expected starting
number — robust regardless of what earlier tests in the file left behind).
Drives remove + stepper-increase, submits, reopens the assign page, and
asserts the edited cadence (not the factory default, not the pre-edit stored
ladder) survives against the real e2e Postgres DB. Full local run (CI-parity
production build via `npm run e2e:local -- reminders.spec.ts
course-role-assignment.spec.ts`): **10 passed, 1 pre-existing skip**
(REM-003, `PLAYWRIGHT_SYSTEM_ADMIN_COOKIE` unset) — no reseed-between-runs
issues, e2e:up/db seed/build/playwright all completed in one `e2e:local`
invocation in well under 2 minutes for these two files.

No product-code defects found this phase — the implementation matched the
plan's stated safety properties exactly, confirmed by the sabotage-and-restore
proof rather than by inspection alone.
