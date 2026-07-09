---
name: e2e-local-auth-url-env-trap
description: RESOLVED — running the e2e suite locally against lms_e2e requires exporting AUTH_URL (not just NEXTAUTH_URL), or NextAuth v5 redirects every successful login to the dead .env origin and every login-dependent test fails with ERR_CONNECTION_REFUSED
metadata:
  type: project
---

**Update 2026-07-09:** `.env` and `.env.local` no longer set `AUTH_URL` or
`NEXTAUTH_URL` at all (verified via grep on branch `rbac`). A full local
`npx playwright test --workers=1` run (all 12 specs, including
`onboarding-wizard.spec.ts`'s login-form-submitting tests) passed with no
extra env exported beyond what's already in `.env.local` + the config's
`webServer.env` override — no `ERR_CONNECTION_REFUSED` reproduced. Treat the
section below as historical: only re-apply the CI-env-block workaround if
`AUTH_URL`/`NEXTAUTH_URL` reappear in `.env` pointing at a different port than
the Playwright server. See also [[e2e-webserver-dev-lock-conflict]] for a
separate, still-current local-run gotcha (a stray `:3000` dev server blocks
the webServer from starting at all).


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

**How to apply:** when running this suite locally, export the **full CI e2e env block from
`.github/workflows/ci.yml` verbatim** rather than reconstructing it from `.env.example` or
memory — it is the source of truth and now includes `AUTH_URL`. Do not stop at `NEXTAUTH_URL`
alone. See also [wsl2-playwright-browser-install](wsl2-playwright-browser-install.md) for the
separate Chromium-install workaround needed on this sandbox.
