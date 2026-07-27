---
name: local-ui-verification
description: Recipe for driving the local dev app with Playwright to verify UI changes (docker services, seed login, redis login lockout)
metadata:
  type: project
---

Verifying a UI change against the running dev server (`http://localhost:3005`) with a Playwright script requires three environment steps that are easy to miss and fail in confusing ways.

**Why:** the dev stack's Postgres/Redis live in stopped docker containers, the dev DB is usually unseeded, and the login rate limiter locks the seeded account out after ~8 scripted logins — each surfaces as a misleading symptom (a generic "Something went wrong" error page, a login form that never redirects) rather than an obvious infra error.

**How to apply:**
1. `docker start lms-dev-db lms-dev-redis theraptly-mailhog` — all three are normally `Exited`. Without the DB the app renders its route error boundary (`PrismaClientKnownRequestError` / `ECONNREFUSED`), which looks like an app bug.
2. `npx prisma db seed` — the dev DB is usually NOT seeded (it may hold a single unrelated real user). The seed creates `admin@test.com` / `Admin123!` (role `owner`, org `e2e-test-org`) plus workers; see [[e2e-seed-infra]].
3. When repeated scripted logins start failing with "Too many login attempts. Please try again in 15 minutes", clear the limiter:
   `docker exec lms-dev-redis redis-cli --scan --pattern 'login*' | xargs -I{} docker exec lms-dev-redis redis-cli del "{}"`
   (`.env.local` points `REDIS_URL` at port **6380**.) `E2E_TEST_BYPASS_RATE_LIMIT=true` is the supported bypass but is not set for plain `npm run dev`.

**When several agents run in parallel, do NOT use the Playwright MCP tools** — they all
share one browser/tab, so a sibling agent navigates out from under you and your
screenshot captures their page. Log in once via MCP, save `storageState` (it must land
under the repo root, e.g. `.playwright-mcp/state.json`), then drive your own
`chromium.launch()` script with that state file. See [[figma-to-css-scale]].

**Script gotchas:**
- Put the script in the scratchpad with a **`.mts`** extension (tsx compiles `.ts` as CJS → "Top-level await is not supported") and symlink the repo's `node_modules` into the scratchpad dir so `playwright` resolves.
- `page.evaluate(fn)` fails with `ReferenceError: __name is not defined` under tsx — pass the body as a **string** instead.
- `page.fill()` on the login form does not enable the submit button; use `locator.pressSequentially()`.
- `npx playwright install chromium` may be needed (browser cache is often absent).
- The dashboard shell scrolls **inside** a container, not the window, so `screenshot({ fullPage: true })` captures only the viewport. `main` is NOT the scroller (it is `h-full` with the overflow on its last child) — grow the viewport to `main > div:last-child`.scrollHeight + header height instead.
- Log in **once** and reuse `storageState` across contexts; each scripted login burns a rate-limit attempt.
