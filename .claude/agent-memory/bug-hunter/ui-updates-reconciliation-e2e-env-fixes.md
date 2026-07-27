---
name: ui-updates-reconciliation-e2e-env-fixes
description: ui-updates branch pixel-perfect restyle — full unit+e2e green-up; two NEW env traps beyond the known AUTH_URL one, a real Playwright locator bug fixed, and a confirmed dev-mode-only quiz-page flake
metadata:
  type: project
---

Full green-up of `ui-updates` branch (large Figma pixel-perfect dashboard restyle, logic
preserved) covered unit (vitest, 138 files / 1935 tests) and the entire e2e suite (26 spec
files). Two genuinely new local-env traps surfaced beyond the already-documented
[[e2e-local-auth-url-env-trap]], plus one real (non-product) test bug and one confirmed
dev-mode-only flake worth knowing about before the next session touches this suite.

**Trap 1 — `NEXT_PUBLIC_APP_URL` baked into the dev server at process start, not request time.**
When the dev server is hand-started (`PORT=3005 npm run dev`, reusing it via Playwright's
`reuseExistingServer: true`), `NEXT_PUBLIC_*` vars are inlined into the client bundle from
whatever `.env`/`.env.local` say *at that process's boot*, not overridden by
`playwright.config.ts`'s `webServer.env` block (that block only applies when Playwright itself
spawns the server). This repo's `.env` ships `NEXT_PUBLIC_APP_URL=http://localhost:3000`. Result:
`signOut({ callbackUrl: `${NEXT_PUBLIC_APP_URL}/login` })` in `NavBar.tsx` pointed at a dead
origin, NextAuth's redirect callback silently fell back to `/`, and every logout-flow e2e test
timed out waiting for `**/login`. Fix: restart the dev server with
`NEXT_PUBLIC_APP_URL=http://localhost:3005 APP_URL=http://localhost:3005` (and `AUTH_URL`/
`NEXTAUTH_URL` for belt-and-suspenders) exported inline on the start command — a plain env
export in the shell afterward does nothing, the value is already compiled in.

**Trap 2 — `NEXTAUTH_SECRET` must ALSO be exported into the `npx playwright test` shell itself**
for any spec that decrypts server-side-encrypted values client-side (e.g.
`mfa-enrollment.spec.ts` / `mfa-login-consolidation.spec.ts` decrypt MFA OTPs to assert on them).
These specs throw a clear, named error (`getMfaEncryptionKey`) when it's missing — not a timeout
— so it's fast to diagnose, but easy to miss since most specs never need it.

**Trap 3 — `E2E_TEST_BYPASS_RATE_LIMIT=true` must be exported to BOTH the dev-server AND the
playwright shell** (already known per [[phase3-quiz-retake-attestation-tests]], reconfirmed here).
Additionally: if a full/partial suite run gets killed mid-flight (e.g. an orphaned background
run), the login rate limiter can already be tripped for `admin@test.com` before your next attempt
even starts. Clear it directly: `docker exec lms-dev-redis redis-cli --scan --pattern 'login:*' |
xargs -I{} docker exec lms-dev-redis redis-cli DEL {}`. Don't assume the bypass flag alone
prevents this — a lockout from a PRIOR run's real (non-bypassed) traffic persists in Redis
regardless of what the CURRENT run's env sets.

**Real test bug fixed (not a regression):** `tests/e2e/billing-stripe-plan-prices.spec.ts`'s
Starter-card locator `page.locator('div.relative').filter({ has: page.locator('#plan-btn-starter') })`
was a known pre-existing flake per [[phase3-quiz-retake-attestation-tests]] — this restyle's new
`DefaultDashboardLayout` root wrapper (`<div className="relative flex h-full w-full bg-white">`)
now ALSO matches that selector, guaranteeing the strict-mode violation whenever real Stripe
test-mode creds happen to be configured (this sandbox had them this session, unlike prior
sessions per that memory — so the flake finally became visible and reproducible). Fixed by
scoping to `div[aria-disabled]` instead, which only the plan cards carry. Worth re-checking if
this locator pattern (`div.<generic-utility-class>`) shows up elsewhere.

**Fixture pollution is aggressive in this suite — always reseed (`npx prisma db seed`) between
full-suite attempts, not just once at the start.** Confirmed three separate pollution sources
this session, all fixed by reseeding (seed.ts deletes/resets the relevant rows, it's not a
partial reset):
- `course.spec.ts`'s ENG-022 test creates a real retake enrollment for `Test Worker` as a side
  effect (documented in the test's own comments) — a second run without reseeding fails
  `getByRole('row', {name: /test worker/i})` with a strict-mode 2-element violation.
- `quiz-retake-attestation.spec.ts` and `reminders.spec.ts`/`TC-016` both mutate durable state
  (quiz attempt history, `course_assignments.target_role`) tied to the SAME shared
  `E2E Compliance Training` course/quiz IDs used across course.spec.ts, quiz.spec.ts,
  quiz-retake-attestation.spec.ts, and reminders.spec.ts. Specifically: `reminders.spec.ts`'s
  TC-016 test (assign-to-whole-role) leaves a `course_assignments` row with `target_role` set,
  which makes the Assign page default to "A whole role" mode on next load — breaking
  REM-001/TC-015/TC-018 (which expect "Specific people" mode / `#assign-input` to exist) on any
  SECOND run of the file without a reseed in between. Within one fresh sequential run this is
  fine (those three tests are positioned earlier in the file than TC-016), it only bites re-runs.

**New MinIO-reachability self-skip pattern added** (no shared helper existed before this
session): `quiz-retake-attestation.spec.ts`'s nurse-attestation test now probes
`MINIO_ENDPOINT:MINIO_PORT` via a raw `net.createConnection` with an 800ms timeout and
`test.skip()`s with a descriptive reason if unreachable — `issueCertificate()`
(`src/app/actions/certificate.ts`) falls back to MinIO when GCS is unconfigured (both true in
this sandbox), so the attestation success screen can never render locally without a running
MinIO container. Confirmed via dev-server log: `ECONNREFUSED ::1:9000` /
`ECONNREFUSED 127.0.0.1:9000` from `issueCertificate`. Mirror this probe pattern (or extract it
to a shared helper) for any future storage-dependent e2e assertion — [[stripe-billing-prices-ssot-tests]]
established the same self-skip idiom for Stripe-config-gated assertions;
`documents.spec.ts`'s header comment independently documents the same MinIO/live-upload gap on
the upload side (it avoids the problem entirely by using pre-seeded documents instead of live
upload).

**Confirmed dev-mode-only intermittent flake, NOT a product regression:** `quiz.spec.ts`'s
ENG-020 test and `quiz-retake-attestation.spec.ts`'s retake test both occasionally fail with
`getByRole('button', {name: 'Start Quiz'}).click()` → "element is not stable" then "element was
detached from the DOM, retrying" → 60s timeout, ONLY when run as part of a large batch (14+
files sequentially). Reproduced 2 of ~4 large-batch attempts; passed 100% (3/3) in solo/small-batch
re-runs of the exact same spec against the exact same seeded state. `playwright.config.ts`
already documents that `next dev`'s lazy route compilation causes exactly this class of local
flakiness (hence CI uses `next start`), so this is consistent with known project behavior, not
new. Did not modify the test (assertion is legitimate and would catch a real regression) or chase
it further — if it starts failing CI (which builds+starts production), that would be the signal
to actually investigate the product code.

**Role-drift pattern from the ProfileForm restyle propagates beyond ProfileForm.test.tsx:** the
profile page's tab buttons changed from `role="button"` to proper `role="tab"` (a real
accessibility improvement, confirmed via `git diff HEAD` showing `role="tablist"`/`role="tab"`
newly added). This broke `getByRole('button', {name: /your facility/i})` /
`/two factor auth/i}` in THREE e2e specs that weren't in the task's "known breakages" list:
`mfa-enrollment.spec.ts`, `mfa-login-consolidation.spec.ts`, `rbac-facility-tab.spec.ts` (4
occurrences). Grep for `getByRole('button'` + any profile-tab-shaped name before trusting a
"known breakages" list is exhaustive — it wasn't, here.

**"Add Workers" → "Add Staff" label drift also missed two files** not in the task's list:
`tests/e2e/staff-invite-flow.spec.ts` (3 occurrences) and `staff-re-invite-lifecycle.spec.ts` (1
occurrence), on top of the two that WERE listed. A plain `grep -rn "add workers" -i tests/e2e/`
across the whole directory is cheap and should always be done rather than trusting a provided
list of affected files, even a detailed one.

See also [[status-tracker-rename-e2e-seed-fixture]] (prior status-tracker rename work — this
session's status-tracker changes went further: stat cards/filters and the separate "At Risk —
Next 7 Days" section were dropped entirely in favor of one merged table, and each row gained a
visually-hidden `sr-only` name span next to its "View" action link for a11y, which turns any bare
`getByText(workerName)` into a strict-mode violation — scope to `getByRole('row', {name: ...})`
instead).
