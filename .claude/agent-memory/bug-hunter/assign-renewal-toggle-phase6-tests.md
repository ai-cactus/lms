---
name: assign-renewal-toggle-phase6-tests
description: Phase 6 (final) of assign-surface consolidation — shared radix-ui Switch + RenewalScheduleInput replacing hand-rolled ToggleSwitch and duplicated renewal Selects; the toggle became the sole way to express "no renewal"
metadata:
  type: project
---

**Context**: `feature/assign-renewal-toggle` closed the last two idiom
divergences between `Step7Assign` (wizard) and `AssignPublishClient` (assign
page): a new `src/components/ui/switch.tsx` (radix-ui `Switch`) replaces both
the wizard's hand-rolled `<button role="switch">` `ToggleSwitch` AND the assign
page's shadcn `Checkbox` for "Send deadline reminders"; a new shared
`RenewalScheduleInput.tsx` holds one canonical `RENEWAL_CYCLE_OPTIONS` (4
entries, wizard labels, `'none'` deliberately absent) used by both hosts.
Wire format unchanged — `renewalCycle` is still exactly one `RenewalCycle`
enum value including `'none'`; `recurringEnabled` is client-only. See
[[reminder-ladder-consolidation-phase5-tests]] for the immediately-preceding
phase this builds on.

**No product defect found.** `AssignPublishClient`'s
`storedRenewalCycle = existingSettings?.renewalCycle ?? 'annual'` +
`recurringEnabled = storedRenewalCycle !== 'none'` correctly gives a fresh
course (no `existingSettings`) toggle-ON at `'annual'` — proven both positively
and by sabotage (see below).

**Red-then-green sabotage technique**: changed
`useState(storedRenewalCycle !== 'none')` to `useState(false)` directly in the
component (not a synthetic bad-input test), reran the 6 new Priority-1 tests:
5 of 6 went red (the 6th — "stored `'none'` hydrates OFF" — stayed green
because it already expects the sabotaged default). Confirms the today-parity
test actually exercises the hydration default rather than being vacuous.
Restored via scratchpad `cp` backup; `git diff --stat` matched the original
uncommitted diff exactly (74 lines, 54 insertions/123 deletions across the two
modified files) before re-confirming 31/31 green in
`AssignPublishClient.test.tsx`.

**Selector-contract claims from the implementing agent, both held on
verification**:
- `getByRole('checkbox')` has zero hits anywhere in the repo for "Send
  deadline reminders" (grepped `tests/e2e/` and every `*.test.tsx` for
  `getByRole('checkbox'` — none reference that control), so the
  `Checkbox`→`Switch` swap broke nothing.
- No e2e spec touches any control this PR changed. The `Set Completion
  Deadline` hits in `staff-assign-courses.spec.ts`/
  `staff-assign-multiple-courses.spec.ts` are `getByText` against a
  `DialogTitle` heading in `AssignCoursesModal.tsx`'s **S4** step (a wholly
  separate, untouched modal) — not the wizard/assign-page toggle.

**Why `Step7Assign.test.tsx` needed zero changes despite the `ToggleSwitch` →
`Switch` swap**: the old hand-rolled `ToggleSwitch` already rendered
`role="switch"` + `aria-label`, and the new shadcn `Switch` (radix-ui) does
too — so `getByRole('switch', { name: ... })` queries were already
role/name-stable across the swap. This is why the regression sweep (27 + 25 =
52 pre-existing tests) passed completely untouched — confirmed by running
before writing any new test.

**`switch.test.tsx` (new, mirrors `alert.test.tsx`/`button.test.tsx` style —
there is no pre-existing `checkbox.test.tsx` in this repo despite the phase
brief assuming one)**: covers both accessible-naming paths deliberately,
since only one is exercised by product code today —
`aria-label` (Step7Assign's/RenewalScheduleInput's toggles) vs. a wrapping
`<label>` (AssignPublishClient's reminders toggle, which passes no
`aria-label`). `Step7Assign.test.tsx:194`'s
`getByRole('switch', { name: 'Set Completion Deadline' })` is load-bearing on
the `aria-label` path specifically.

**`RenewalScheduleInput.test.tsx` (new)**: reused the exact jsdom Radix-Select
stub block (`ResizeObserverStub` + `hasPointerCapture`/`setPointerCapture`/
`releasePointerCapture`/`scrollIntoView`) from `Step7Assign.test.tsx`/
`ReminderLadderInput.test.tsx` — needed to open the interval listbox and
assert exactly 4 `option`s with no `'none'`/`'No renewal'` text anywhere in
it. The `cycle === 'none'` + toggle-on case (an org's row genuinely stored
`'none'` while the toggle got flipped back on some other way) renders the
Select's placeholder rather than a stale label — worth a dedicated case since
it's the one state combination a naive implementation could get wrong.

**e2e**: `npm run e2e:local -- reminders.spec.ts course-role-assignment.spec.ts`
— 10 passed, 1 pre-existing skip (`PLAYWRIGHT_SYSTEM_ADMIN_COOKIE` unset,
same as [[assign-deadline-time-phase4-tests]]/[[reminder-ladder-consolidation-phase5-tests]]).
No new e2e coverage added — confirmed via grep that no spec drives the
changed controls, so there was no stale spec to fix and nothing new to point
at a real UI a user drives (RENEWAL_CYCLE_OPTIONS/the toggle are exercised
thoroughly at the unit level instead).
