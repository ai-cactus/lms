---
name: e2e-local-auth-url-env-trap
description: Fixed by .env.e2e (AUTH_URL=http://localhost:3005); still bites a raw `npx playwright test` because .env pins AUTH_URL=:3000 — NextAuth v5 then redirects every login to the dead origin (ERR_CONNECTION_REFUSED)
metadata:
  type: project
---

**How to apply (2026-09):** run e2e only through `npm run test:e2e` / `npm run e2e:local`. Both
load `.env.e2e` (via `scripts/with-e2e-env.sh`), which sets `AUTH_URL=http://localhost:3005`.
The trap below still bites a raw `npx playwright test`, because `.env` pins
`AUTH_URL=http://localhost:3000`. See also [[e2e-webserver-dev-lock-conflict]] (a stray `:3000`
dev server blocks the webServer from starting at all).

Running `npx playwright test tests/e2e` locally (against a dedicated `lms_e2e` Postgres DB,
`CI=true` forcing workers:1/retries:2) reliably failed the same 6 tests every time — every
test that submits the real login form (`ENG-002`, `ENG-022`, `ENG-024`, `ENG-020`, `REM-001`,
`REM-002`) — with `page.waitForURL: net::ERR_CONNECTION_REFUSED` right after
`page.click('button[type="submit"]')`. Tests that never submit the login form (all of
`signup-email-verification.spec.ts`, and `auth.spec.ts`'s ENG-001 which only intercepts an
outbound OAuth POST without waiting for its response) passed reliably.

**Root cause:** `.env` sets `AUTH_URL="http://localhost:3000"`. NextAuth v5 prefers `AUTH_URL`
over the legacy `NEXTAUTH_URL` when both could apply, and the local run only exported
`NEXTAUTH_URL=http://localhost:3005` (matching the `.env.example`/older convention) — not
`AUTH_URL`. Next.js dev loads `.env`'s `AUTH_URL` (nothing in the shell env pre-empts that
specific key), so on every successful credentials login the server redirected the browser to
`http://localhost:3000/dashboard` — a dead origin in this setup (the app runs on port 3005) —
and the browser's next-navigation wait failed with connection-refused. `curl`-driven login
tests against `/api/auth/callback/credentials` did **not** reproduce this because curl (without
`-L`) doesn't follow the redirect chain the way a real browser navigation does, which is why
manual API-level reproduction attempts kept coming back "fine."

**Verified both directions:** `ENG-002` reproduces the exact failure with `AUTH_URL` unset
(only `NEXTAUTH_URL` exported), and passes in ~3-9s once `AUTH_URL=http://localhost:3005` is
also exported. This is now baked into the CI e2e job env block in `.github/workflows/ci.yml`,
so GitHub Actions runs are unaffected — this trap only bites **local** runs that hand-roll the
env instead of using the CI workflow's env block verbatim.

**Related but not causal:** a Prisma P2022 `session_version`-column error, observed in some
runs referencing a real dev-DB (`lms`) user ID during the login's bcrypt-cost-upgrade path, was
a red herring / side observation from debugging the same symptom before AUTH_URL was
identified — it did not cause the connection-refused cascade (the erroring update transaction
never committed; `lms` was confirmed untouched throughout via `updated_at` timestamps).

**Original diagnosis context:** the local run above hand-rolled its env instead of using a
checked-in env file. `.env.e2e` now carries the full block, including `AUTH_URL`.
