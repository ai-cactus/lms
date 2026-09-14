---
name: role-target-picker-stale-locator-sweep
description: PR #595's RoleTargetPicker broke reminders.spec.ts TC-016 (option→checkbox) undetected for 5 merges; full local suite runs on this box collapse to Postgres ECONNREFUSED past ~100 tests — trust targeted CI-parity slices instead. STALE RECIPE NOTE (2026-09-12): the toggle button text below is outdated — see [[assign-role-label-due-date-tests]]
metadata:
  type: project
---

**PR #595 replaced the assign page's single-role `Select` with the shared
`RoleTargetPicker`** (`src/components/dashboard/enrollment/RoleTargetPicker.tsx`),
which renders `Checkbox` rows inside `role="group"` (`aria-label="Assignable
roles"`) — no `role="option"`/`combobox` anywhere. `reminders.spec.ts` TC-016
still drove the old shape (`getByRole('combobox').first().click()` then
`getByRole('option', { name: /front desk/i })`), so it 60s-timed-out on every
retry in CI. It went undetected for 5 merges (#595-#599 landed on top of it)
because **CI only runs the full Playwright suite on a promotion PR** (dev→staging),
not on every feature PR into dev — see [[full-e2e-suite-serial-flakiness]] for
the related fixture-staleness context this same describe block has produced
before. `course-role-assignment.spec.ts` (added alongside #595) already had the
correct interaction and was the reference pattern:
```
await page.getByRole('button', { name: 'A whole role' }).click();
await page.getByRole('button', { name: 'Choose roles' }).click();
await page.getByRole('checkbox', { name: 'Nurse' }).click();
await page.getByRole('heading', { name: 'Assign', exact: true, level: 1 }).click(); // closes the overlay
await expect(page.getByRole('group', { name: 'Assignable roles' })).toBeHidden();
```

**⚠️ STALE as of 2026-09-12**: the toggle button text `'A whole role'` above was
renamed to `'Roles'` (`AssignPublishClient.tsx`) as part of the fix that also
made the Due Date field render in role mode (it had been wrongly hidden there —
see [[assign-role-label-due-date-tests]]). Both e2e specs quoted above were
updated to `page.getByRole('button', { name: 'Roles', exact: true })`. Do not
reintroduce `'A whole role'` from this snippet — it will 60s-timeout exactly
like the original TC-016 break this file documents.
**A second, independent staleness in the same test wasn't in the original bug
report**: the pre-submission "current holder" preview assertion
(`getByText(/will be enrolled now/i)`) no longer matches anything — that phrase
only exists post-submission, in `AssignPublishClient.tsx`'s success dialog
("Existing workers are now enrolled..."). `RoleTargetPicker.tsx`'s own
pre-submission copy (added by #595) reads "N people currently hold the selected
roles — plus anyone assigned one later." Fixing only the locator without
re-checking every assertion string in the same test would have left it green on
the interaction but never actually verifying the preview copy. **General
lesson: when a redesign changes a control, grep the whole test body for BOTH
interaction locators AND assertion text scoped to that component — a stale
locator bug report doesn't guarantee it's the only staleness in the test.**

**Full local-suite run (182 tests, CI-parity prod build) collapsed to 77
failures with `connect ECONNREFUSED 127.0.0.1:5442`** (the e2e Postgres port)
appearing across totally unrelated spec files (signup, session-isolation,
settings-page, rbac-roles migration checks, worker-billing-gate) roughly after
test ~100 of ~190, ~7.8 min in. This is a heavier version of the already-known
[[full-e2e-suite-serial-flakiness]] pattern (previously observed as fixture
staleness in 3-5 specific files) — here the DB connection itself was lost,
consistent with this WSL2 box's documented resource limits. **How to apply:**
don't trust a full unattended `npm run e2e:local` (no file filter) run on this
box as a regression signal by itself. Cheaper and reliable: run the specific
spec(s) touched (`npm run e2e:local -- <spec>.spec.ts <other>.spec.ts`,
reseeding between attempts) — every spec actually relevant to a change here
(`reminders.spec.ts` 9/10 + 1 skipped, `course-role-assignment.spec.ts`,
`assign-course-invite.spec.ts`, `course-publish-review-gate.spec.ts`,
`course-creation.spec.ts`, `course-creation-phi-rejection.spec.ts`,
`course.spec.ts`, `staff-invite-flow.spec.ts`, `rbac-invite-roles.spec.ts` — 24
tests total) passed cleanly in two separate CI-parity slice runs, while the
unattended full run failed on files with zero relationship to the change.

**Wizard sweep (PR #597/#598 — single-document Step2Upload, cmdk Step1
Category, flattened quiz-review) found nothing stale in e2e.** All e2e Step 1
interactions (`getByRole('combobox').first().click()` then
`getByRole('option').first().click()`) already match the current
`Step1Category.tsx` (explicit `role="combobox"` trigger button + cmdk
`CommandItem`, which renders `role="option"` — confirmed previously in
[[course-wizard-pr3b-restyle-test-patterns]]). `course-wizard-module-builder.spec.ts`
(the old multi-module builder spec) is already deleted, replaced by
`course-creation.spec.ts`'s own docstring explaining the single-document
model. The quiz-review accordion flattening was only ever covered at the unit
level (`Step6QuizReview.test.tsx`) — no e2e spec touches that screen's
internals, so there was nothing to sweep there.
