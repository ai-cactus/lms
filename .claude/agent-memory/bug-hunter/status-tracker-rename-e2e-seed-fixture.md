---
name: status-tracker-rename-e2e-seed-fixture
description: prisma/seed.ts now includes a deterministic overdue-enrollment fixture (Olivia Overdue) for Status Tracker/reminders e2e coverage; email substring collision gotcha with the WORKER_EMAIL selector
metadata:
  type: project
---

## Seeded overdue-enrollment fixture

`prisma/seed.ts` previously had no enrollment with a past `dueAt` at all — REM-004
(hard-escalation banner) was permanently `test.skip()`'d for exactly this reason.
Added a dedicated fixture (kept separate from sarah/worker so their
status-specific fixtures — ENG-020's in_progress quiz flow, ENG-022's locked
retake flow — are never disturbed):
- User: `olivia.overdue@test.com` / profile fullName `Olivia Overdue`
  (`OVERDUE_WORKER_ID`).
- Enrollment (`ENROLLMENT_OVERDUE_ID`): status `in_progress`, `dueAt` computed
  as `now - 10 days` at seed time (always ≥7-day HARD_ESCALATION-overdue,
  regardless of when CI runs).

This unblocked REM-004 (now un-skipped) and two new specs, REM-005 (nav
rename + `/dashboard/status-tracker` heading) and REM-006 (admin-dashboard
Status Tracker overview widget: counts, "View all" link, overdue worker in
top-5), all in `tests/e2e/reminders.spec.ts`.

## Email-substring collision gotcha (real regression caught by full-suite run)

The first fixture email chosen, `overdue.worker@test.com`, is a **substring
match** for the existing `WORKER_EMAIL` constant (`worker@test.com`) used by
REM-002's `page.getByRole('row', { name: new RegExp(WORKER_EMAIL, 'i') })`
selector — Playwright's accessible-name regex match against
`overdue.worker@test.com` also matches, causing a strict-mode violation (2
rows) and failing REM-002. Renamed to `olivia.overdue@test.com` (no longer
contains the substring `worker@test.com`) and it passed. **Lesson: before
adding any new seeded fixture whose email/name might be matched by an
existing regex-based Playwright locator, grep `tests/e2e/*.spec.ts` for
`new RegExp(` and substring-style `getByText`/`getByRole` name matchers
against existing seed emails/names — a superset string silently breaks
strict-mode selectors elsewhere.** Always rerun the *full* e2e suite (not just
the new/target spec) after any `prisma/seed.ts` change — this bug only showed
up on a full-suite run, not when running `reminders.spec.ts` alone.

## Known flake: dev-server cold-start under WSL2, unrelated to product code

One full-suite run (of 4 total) showed `ENG-022` (course.spec.ts) and
`ENG-020` (quiz.spec.ts) failing all 3 attempts each with strict-mode/timeout
errors, while 3 other full-suite runs (before and after, on identical code)
were clean (21 passed, 1 skipped, ~48s). Isolated rerun of ENG-022 alone on a
freshly reseeded DB passed cleanly in 6.5s. Root cause is almost certainly
Next.js dev-mode on-demand compilation cold-starting under WSL2 resource
contention combined with `webServer.reuseExistingServer: !CI` — with
`CI=true` locally (per the runbook) every `npx playwright test` invocation
starts a brand-new dev server, so the *first* hit to a given route pays a full
compile cost that can exceed default timeouts under load. Not caused by any
seed/spec change — both failing tests use only the pre-existing sarah/worker
fixtures. If this reproduces again, rerun the full suite once before treating
it as a regression; CI's dedicated runners are less prone to this than a
local WSL2 box. See also [[e2e-local-auth-url-env-trap]].

## Dashboard page + widget unit coverage added

- `src/components/dashboard/status-tracker/StatusTrackerOverview.test.tsx` —
  the widget itself does the top-5 `rows.slice(0, MAX_ROWS)` slicing (not the
  server page), so it's covered here: empty state, top-5 truncation,
  hard-escalation color threshold (`>=`), singular/plural "day" text.
- `src/app/dashboard/(main)/page.test.tsx` — first test file for this async
  Server Component. Followed the established pattern (call `DashboardPage()`
  directly, `render()` the result — see `src/app/join/[token]/page.test.tsx`
  precedent noted in [[qa-wave1-regression-patterns]]). Stubs every child
  component; `StatusTrackerOverview` is mocked to a prop-capturing spy so the
  page's `organizationId ? fetch : zeroed-fallback` branch and the
  Date→ISO-string row serialization are asserted directly without depending
  on the widget's own rendering.
