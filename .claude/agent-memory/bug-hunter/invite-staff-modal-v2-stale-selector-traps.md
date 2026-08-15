---
name: invite-staff-modal-v2-stale-selector-traps
description: Four cascading, self-masking e2e locator mismatches found in InviteStaffModal's invite flow after the multi-facility wave added a required Facility field — a fix-and-rerun playbook for any future InviteStaffModal e2e regression
metadata:
  type: project
---

During the multi-facility UI-wave validation (2026-08-11/12), 12 of 13 initial e2e failures
traced to the SAME component (`src/components/dashboard/staff/InviteStaffModal.tsx`) across 4
spec files (`rbac-invite-roles.spec.ts`, `staff-invite-flow.spec.ts`,
`remove-reinvite-clean-slate.spec.ts`, `staff-re-invite-lifecycle.spec.ts`) plus a related
component rebuild affecting `settings-page.spec.ts`'s Add Facility tests. None were product
bugs — all were specs that predated a UI rewrite and were never updated for it (these 4 files
were NOT in the implementers' "already updated" list, unlike `settings-page.spec.ts`, which
*was* updated but incompletely).

**Trap 1 — Facility select now gates step 1→2.** `goToAssign()` (line ~277) requires
`facilityChoice` truthy; an unselected Facility silently blocks `Continue` from advancing past
step 1 (no visible error until the click, then a paragraph reads "Select a facility before
continuing."). Fix: `await page.getByRole('combobox', { name: 'Facility' }).click(); await
page.getByRole('option', { name: /^global/i }).click();` before filling emails/CSV.

**Trap 2 — this hid behind a false-positive locator, wasting the most debug time.** Every
affected test asserted `getByText('Assign roles')` was visible after clicking Continue — but
Playwright's `getByText(string)` is case-insensitive substring matching, and step 1's own
description paragraph reads "...so you can assign roles." (lowercase, same words). The
assertion spuriously PASSED while the modal was still stuck on step 1, so the actual failure
surfaced several lines later on an unrelated locator (`combobox.nth(1)` not found, or role
options not present in what was actually the Facility dropdown), making the real cause
non-obvious from the error alone. **The definitive diagnostic is the `error-context.md` page
snapshot** — it showed dialog title "Invite New Staffs" (step 1) even though the "Assign
roles" assertion had already reported success. Fix: use
`page.getByRole('heading', { name: 'Assign roles', exact: true })` instead — the DialogTitle
is the only exact match.

**Trap 3 — step-2 submit button is dynamically labeled, never "Continue".** It reads
`` `Invite ${n} staff${n === 1 ? '' : 's'}` `` (line ~649) — e.g. "Invite 1 staff" / "Invite 2
staffs" (note: no article, and the plural is grammatically odd but intentional, verify against
source before assuming a typo). Fix: `page.getByRole('button', { name: /^invite \d+ staffs?$/i })`.

**Trap 4 — the success dialog's dismiss button reads "Okay", never "Done".** Fix:
`page.getByRole('button', { name: /^okay$/i })`.

**Trap 5 (settings-page.spec.ts only) — `FacilityTypeMultiSelect` was rebuilt from inline
checkboxes into a Popover-triggered chip multi-select.** The trigger is
`getByRole('button', { name: 'Facility type' })`; only after clicking it do the checkboxes
(including "Other (specify)", which is now just another checkbox in the same list — NOT a
separate button-then-checkbox toggle like the prior design documented in
[[add-facility-modal-v3-test-patterns]]) render, and they render in a Radix Popover **portal**
appended to `<body>` — query them from `page`, not a dialog-scoped locator (same portal-scoping
trap as that memory's `SupervisorCombobox` finding, now confirmed to also apply here).
[[add-facility-modal-v3-test-patterns]] is now partially stale on this specific point — treat
its checkbox-locator guidance as superseded by this trigger-first pattern.

**How to apply:** if a future InviteStaffModal or AddFacilityModal change breaks e2e specs
again, check these 5 exact points first before assuming a new root cause — they are the most
failure-prone surface in this component. Also see [[vitest-cpu-contention-flake]] and this
session's broader lesson: re-seed (`npx prisma db seed`) between repeated e2e invocations
against the same long-lived local Postgres — running the full suite 4+ times back-to-back
without reseeding produced a duplicate "Test Worker" row (`getByRole('row', ...)` strict-mode
violation) that was pure session self-pollution, not a regression; a fresh seed made it
disappear immediately.
