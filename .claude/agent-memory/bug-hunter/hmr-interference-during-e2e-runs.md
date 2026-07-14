---
name: hmr-interference-during-e2e-runs
description: Editing ANY repo file (even unrelated test/memory files) while a Playwright run is live against the dev-mode webServer causes spurious click/navigation hangs via React Fast Refresh remounts — false product-bug signal
metadata:
  type: feedback
---

Editing files in this repo (via Edit/Write, from ANY tool call) while a background
`npx playwright test` run is executing against the dev-mode `webServer`
(`npm run dev -- -p 3005`, per `playwright.config.ts`) can trigger spurious,
hard-to-diagnose test failures that look exactly like product bugs but aren't.

**Symptom:** a `.click()` on a previously-working, previously-clicked element
(e.g. a table row's text to navigate) hangs for the full test timeout
(`Test timeout of 90000ms exceeded` / `locator.click: Test timeout ... exceeded`)
with no clear reason. Screenshots show the element present and apparently
normal. Isolated single-test reproductions of the *same* interaction succeed
instantly, which is the tell that it's environmental, not a real bug.

**Root cause (confirmed via `page.on('console', ...)`):** the dev server's
Turbopack/webpack watcher fires `[Fast Refresh] rebuilding` / `done` cycles
mid-test even when the edited file has nothing to do with the page under test
(observed while only editing `tests/e2e/*.spec.ts` and `.claude/agent-memory/*.md`
files — NOT `src/`). Fast Refresh remounts React trees, which discards Radix
open/menu state and can make a click target's underlying DOM node get replaced
between Playwright's actionability check and the actual event dispatch,
producing an apparent hang.

**Why:** cost real debugging time — chased this as a suspected product bug
(RBAC permission gating on the staff list) for a while, including writing two
standalone debug repro specs, before noticing the correlation with concurrent
file edits via console log timestamps.

**How to apply:**
- Once a `npx playwright test ...` run is kicked off (foreground or
  background), do NOT edit/write ANY file in the repo until it completes —
  including seemingly-unrelated files (memory notes, other test files, docs).
  Finish other file edits first, or wait for the run to finish before editing.
- If a test hangs on a `.click()`/navigation with no other explanation, and an
  isolated single-test rerun of the same interaction passes cleanly, suspect
  this HMR-interference pattern before concluding it's a product bug — verify
  by rerunning the SAME spec standalone with zero concurrent file edits.
- Prefer `page.goto(knownUrl)` over clicking a list row to reach a detail page
  in specs whose actual subject is the destination page (not the row-click
  interaction itself) — it's both more robust against this class of flake and
  more precisely scoped to what the test is actually verifying.
- Related: [[e2e-webserver-dev-lock-conflict]] (a different dev-server
  gotcha — that one is about a stray `:3000` server blocking webServer
  *startup*; this one is about live HMR during an already-running test).
