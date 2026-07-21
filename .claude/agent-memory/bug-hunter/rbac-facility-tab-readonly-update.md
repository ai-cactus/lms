---
name: rbac-facility-tab-readonly-update
description: rbac-facility-tab.spec.ts updated for permission-driven-sidebar era (all roles get facility.read, facility form is read-only); Playwright default parallel workers cause Prisma connection-pool exhaustion against local Postgres
metadata:
  type: project
---

Updated 2026-07-14 on branch `rbac` after commit `6da210c` ("feat:
permission-driven sidebar modules, read-only org/facility forms, sticky
headers") made two changes the old spec didn't reflect:

1. Every manager role (including `hr`) now has `facility.read`
   (`src/lib/rbac/permissions.ts`), so the "Your Facility" tab on
   `/dashboard/profile` is visible to all of them — the tab is gated purely
   on `can(roleKey, 'facility.read')` in
   `src/app/dashboard/(main)/profile/page.tsx:29`.
2. `FacilityForm.tsx` now renders every field `disabled`/`readOnly`
   unconditionally (editing moved to the owner-only Settings page,
   `tests/e2e/settings-page.spec.ts`). There is no save flow on the profile
   page's facility tab at all — no Save button renders in that tab's DOM,
   since the page's only Save button lives inside the separate `profile` tab
   block and is gated on that tab's own `isDirty`.

Rewrote the old "hr does NOT see the tab" test to assert visibility instead,
and replaced the "owner edits+persists facility phone via profile page" test
(which clicked a disabled input and timed out) with an assertion that the
phone `input[type="tel"]` is disabled and no Save/submit button exists in
that tab. `settings-page.spec.ts` already covers owner facility-field
persistence via the Settings page's Facility tab — no coverage gap.

**Environment flake found while verifying, not a spec bug:** running this
4-test spec with Playwright's default (unset) `workers` value — which spawns
one worker per CPU core — causes all 4 logins to race against the local
Docker Postgres container (port 5433) simultaneously. The local dev-mode
Next.js server's Prisma queries (`getDashboardData` on the post-login
`/dashboard` redirect) then hit `Error: timeout exceeded when trying to
connect` / `Connection terminated due to connection timeout`, and each
`/login` POST + subsequent `/dashboard` GET takes ~18-23s — past this spec's
15s `waitForURL` timeout — so all 4 tests fail simultaneously with no product
code involved. Confirmed by re-running with `--workers=1`: all 4 pass in
~13s, and by checking `organizations` table afterward — the `finally`
cleanup blocks removed all seeded rows from the failed parallel run, so no
manual DB cleanup was needed. Root cause is almost certainly the same disk
pressure documented in [[rbac-sidebar-module-gating-tests]] (host free disk
was ~3.6G this session) constraining the Postgres container's usable
connections — not something to fix in the spec. If this spec (or another
multi-login-per-file e2e spec) flakes with `waitForURL` timeouts when run via
the full `npx playwright test` suite, try `--workers=1` before assuming a
product regression.

Related: [[rbac-sidebar-module-gating-tests]], [[org-facility-split-test-patterns]].
