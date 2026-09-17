---
name: gotcha-org-picker-spec-red-on-dev
description: tests/e2e/org-picker.spec.ts has one test failing on clean dev as of 2026-09-16 — verify the baseline before blaming your branch.
metadata:
  type: project
---

`tests/e2e/org-picker.spec.ts` → "selecting an organization from the picker
activates that membership's role for the session" **fails on a clean `dev`**
(verified at `befdb36`, 2026-09-16, by stashing and re-running). It asserts the
`hr` membership sees no Settings nav link; Settings renders anyway. All 3 other
tests in the file pass.

**Why it matters:** the full suite is ~6.5 min and CI does not run Playwright on
feature PRs, so this is the one red result you will hit on any branch. Attributing
it to your own change costs a debugging cycle.

**How to apply:** when `npm run e2e:local` comes back `1 failed / 13 skipped /
184 passed`, check whether the failure is this test before investigating. To
confirm a baseline for any e2e failure: `git stash push -u`, re-run the single
spec, `git stash pop`. The spec file itself documents a related KNOWN PRODUCT BUG
in `recordMembershipLogin` further down — likely the same root cause, but the
failing assertion is not the one that bug's comment guards.
