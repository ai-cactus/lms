---
name: assign-deadline-time-phase4-tests
description: Phase 4 of assign-surface consolidation (TimePicker + due-time hydration fixing the D-F/#607 interaction bug) — jsdom portal-dismiss trap, TimePicker mock decision, red-then-green technique
metadata:
  type: project
---

**Context**: `AssignPublishClient`'s `toDateInput()` truncated a stored deadline
to `YYYY-MM-DD`, dropping the time-of-day. Combined with #607's
`isPastDeadlineChange` (refuses a past deadline only when it CHANGES the
stored one), an unchanged re-save of a past non-midnight deadline (e.g.
`17:00Z`) sent midnight back, compared unequal to the stored value, and was
wrongly refused with "The deadline must be in the future." Fixed via
`formatTimeOfDay` (new, in `src/lib/reminders/deadline.ts`, the inverse of the
private `parseTimeOfDay`) hydrating a new `dueTime`/`scheduleTime` state, and
`TimePicker.tsx` rewritten (216 lines) to portal to `<body>` like `DatePicker`.
See [[assign-role-label-due-date-tests]] and [[assign-consolidation-phase1-tests]]
for the immediately-preceding phases this builds on.

**jsdom cannot reproduce Radix's "was this outside the dialog?" judgment for a
plain (non-Radix) `createPortal` child.** I initially wrote an integration test
that opened `AssignCoursesModal`'s TimePicker, fired `pointerDown`/`click` on a
button inside `#time-picker-popover`, and asserted the modal's `onClose` mock
was NOT called (to prove the `DialogContent onInteractOutside` guard covering
`#time-picker-popover` works). It passed — but ALSO passed with the guard
deliberately deleted, i.e. it was vacuous. Root cause (as far as I could
determine): React's own portal-aware event delegation sets
`isPointerInsideReactTreeRef.current = true` via a capture-phase handler on
`DialogContent`'s root BEFORE Radix's document-level bubble-phase
`pointerdown` listener runs — because the portalled node is still a REACT
descendant of `DialogContent` even though it's a DOM sibling under
`<body>` — so Radix's own dismiss logic already treats it as "inside"
independent of the app-level guard, at least under jsdom + RTL's synthetic
dispatch. **Fix**: test the guard's own conditional logic directly instead of
going through Radix. Mock `@/components/ui/dialog`'s `DialogContent` to record
its props (still rendering the real `actual.DialogContent` underneath, so
nothing else in the suite changes), then call the captured `onInteractOutside`
handler manually with `{ target: <real #time-picker-popover element>,
preventDefault: vi.fn() }` and assert `preventDefault` was/wasn't called. This
is deterministic and — verified via sabotage (deleting `, #time-picker-popover`
from the guard's `closest()` selector) — actually red/green, unlike the
Radix-driven version. If a future dialog-outside-click regression needs
covering, use this capture-the-prop-and-call-it-directly pattern, not a
simulated Radix dismiss.

**`fireEvent.mouseDown` does not exercise Radix's `DismissableLayer` at all** —
it listens for `pointerdown`, not `mousedown`/`click`, registered on
`ownerDocument` after a `setTimeout(0)` (already elapsed by the time any
`await`-driven test reaches this point). Use `fireEvent.pointerDown` if you
ever need to drive the real Radix path (e.g. for a positive-control "genuinely
outside DOES close" assertion) — `fireEvent.mouseDown` will silently no-op.

**`vi.useFakeTimers()` (no options) hangs any test using RTL's `waitFor` for
5000ms** — `waitFor`'s internal polling timer becomes fake and nothing advances
it. Fixed with `vi.useFakeTimers({ toFake: ['Date'] })`, which freezes
`Date`/`Date.now()` for deterministic D-F fixture dates (avoiding the
fixture-date-rot trap — see [[assign-consolidation-phase1-tests]]) while
leaving `setTimeout`/`setInterval` real so `waitFor` and `userEvent` keep
working. Also avoid `userEvent` for interactions inside a fake-Date-only
describe block if the flow doesn't strictly need realistic key-by-key
typing — `fireEvent.change`/`fireEvent.click` are simpler and match the
existing project convention in `AssigneesInput.test.tsx`'s fake-timer block.

**TimePicker mock decision for `AssignPublishClient.test.tsx`**: mocked it the
same way as the pre-existing `DatePicker` mock (plain controlled `<input
aria-label/placeholder/value/onChange>`), rather than driving the real analog
clock. Rationale: `TimePicker.tsx` got its own dedicated unit-test file
(`src/components/ui/TimePicker.test.tsx`, new) covering placement, portal,
outside/inside-click, and the value round trip in isolation — `AssignPublishClient`'s
tests only need to prove the PAGE's wiring (hydration from `existingSettings`,
submit-payload shape), which a plain input proves without portal/positioning
noise. `formatTimeOfDay`/`combineDateAndTime` themselves are NOT mocked in
either file, so the hydration and D-F round-trip tests exercise the real
business-rule functions.

**Red-then-green technique used for both fixed defects**: (1) for the
known-stale `AssignCoursesModal.test.tsx:219` assertion pinning the old
`YYYY-MM-DD` string wire shape, ran the suite BEFORE editing the test and
confirmed the exact stale-vs-new-shape diff Vitest printed
(`"dueAt": StringContaining "2026"` vs `2026-10-13T23:59:00.000Z`) before
rewriting the assertion; (2) for the new Priority-1 D-F tests in
`AssignPublishClient.test.tsx`, temporarily hardcoded `toTimeInput()` to always
return `''` (simulating the pre-fix truncation) via the Edit tool, re-ran
`-t "Priority 1"`, confirmed 5 of 5 new tests failed with exactly the expected
diffs (midnight vs `17:00Z`, etc.), then restored the file byte-for-byte from
a scratchpad backup and re-confirmed 19/19 green. Product files end up
byte-identical to the phase's original uncommitted diff (`git diff --stat`
against `ae92055` matched exactly: 68/+81/+216/+24 lines across the four files)
— verify this after any red/green sabotage-and-restore cycle before reporting.

**e2e**: `reminders.spec.ts` (8/8, 1 pre-existing skip —
`PLAYWRIGHT_SYSTEM_ADMIN_COOKIE` unset), `course-role-assignment.spec.ts`
(1/1), `staff-assign-courses.spec.ts` (3/3), `staff-assign-multiple-courses.spec.ts`
(1 pre-existing skip — seed not ported, per its own comment). No strict-mode
locator ambiguity from adding a second picker per row — the product code's
distinct `Select time`/`Select due time` TimePicker placeholders (vs.
`Select date`/`Select due date` for DatePicker) hold up in a real browser, and
TimePicker's trigger is a text `<input>` (role `textbox`), never a `<button>`,
so `page.getByRole('button', { name: 'Select due date' })` in
`pickFutureDate()` never had a TimePicker candidate to collide with regardless.
