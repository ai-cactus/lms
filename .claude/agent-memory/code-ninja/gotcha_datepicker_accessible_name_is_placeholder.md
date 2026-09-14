---
name: gotcha-datepicker-accessible-name-is-placeholder
description: DatePicker/TimePicker triggers are resolved in e2e by their placeholder text; adding a `label`/aria-label silently breaks those specs and CI won't catch it
metadata:
  type: feedback
---

`src/components/ui/DatePicker.tsx` renders a `<button>` whose accessible name is
its **placeholder text** (there is no visible `<label>`), and `reminders.spec.ts`
resolves both pickers on the assign page with
`page.getByRole('button', { name: 'Select due date' | 'Select date' })`. Passing
the component's optional `label` prop sets `aria-label`, which **overrides** the
text content and makes those locators miss.

**Why:** the two pickers on `AssignPublishClient.tsx` are otherwise identical, so
the spec's only discriminator is the placeholder — it says so in its own header
comment. And per CLAUDE.md, CI reports `E2E: SKIPPED` on feature PRs, so a break
here merges green and only surfaces on a promotion PR days later.

**How to apply:** when adding or re-arranging a `DatePicker`/`TimePicker` on an
assign surface, keep the existing placeholder strings verbatim and do **not** add
`label`. Give a *new* sibling picker a distinct placeholder instead (e.g.
`Select due time` next to `Select due date`) so neither locator becomes
ambiguous under Playwright strict mode.

Related: [[gotcha-timepicker-popover-portals]].
