---
name: local-ui-verification
description: Recipe for driving the local dev app with Playwright to verify UI changes (docker services, seed login, redis lockout, stale Prisma client, no local Vertex AI)
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

`npm run dev` binds **3000** by default — start it as `PORT=3005 npm run dev` for the port everything else assumes. Next 16 enforces **one dev server per project dir**: if someone (the user, or a sibling agent) already has one up, your `PORT=3005 npm run dev` exits immediately with "Another next dev server is already running" and prints the live port + PID. Do NOT kill it — point your Playwright script at the port it reports instead. A one-off `npx tsx` script that imports `@/db/index` must be **inside the repo root** (tsconfig path aliases) and needs the env sourced first: `set -a && source .env && source .env.local; set +a` — otherwise Prisma fails with `SASL: client password must be a string`.

**Do not assume 3005 is ours.** A listener on 3005 can be a *stale/other* Theraptly build that
serves `/login` with the marketing panel but **no form at all** (0 `<input>`, 0 `<form>`), so
`waitForSelector('form')` just times out and looks like a hydration bug. Probe both ports and
pick the one whose `/login` actually has inputs before blaming the script.

**A long-running dev server serves a STALE Prisma client.** `src/lib/prisma.ts` caches the client on `globalThis` in dev, so a `prisma generate` (or a migration adding columns) after the server started is NOT picked up by HMR: writes to the new columns fail in the app with `PrismaClientValidationError` ("Unknown argument …") while the exact same call succeeds from a fresh `npx tsx` script against the same DB. Symptom looks like a code bug — check `stat generated/prisma` against the dev-server start time (`ps aux | grep next`) before debugging the code. Restarting `npm run dev` is the fix.

**AI generation cannot complete locally.** `callVertexAI` uses Google ADC (`auth.getAccessToken()`), and no default credentials exist in this env — `GEMINI_API_KEY` in `.env` is unused by that path. Every v4.6 job therefore fails at Stage A with "Could not load the default credentials", ~10s after it is created. Job creation, polling, the generation UI and the failure/retry paths are all still verifiable live; only the generated content is not.

**Walking steps 1-5 of the wizard live without any upload:** open
`/dashboard/courses/create?documentId=<id>` — the deep link seeds module 1 with an
already-stored document, so step 2 needs only a title/objective/deadline. A seeded usable id is
`32b4c693-5421-472d-baa4-10e7d9e332ca` (`Infection-Control-Policy.pdf`); confirm it still exists
before relying on it. Selectors that matter: the step-2 deadline picker is
`[aria-labelledby="module-deadline-label"]`, and the step-9 role picker is a **custom button +
checkbox group**, not a Radix combobox — click `button:has-text("Choose for specific roles")` then
`label[for="assign-group-workers"]` (`getByRole('option')` finds nothing).

**Step 6's "Your course is being created…" checklist is hard to catch.** With a short document the
job fails *synchronously* ("Document content is empty or too short to generate a course"), well
under 2s — far faster than the ~10s Vertex-credential failure — so a plain `waitForTimeout` then
screenshot lands on the failure screen instead. Polling runs through a **server action**, not a
fetch URL, so hold the state by hanging the POSTs:
`page.route('**/dashboard/courses/create**', r => r.request().method()==='POST' ? new Promise(()=>{}) : r.continue())`.
Install the route **after** the resume banner is on screen — installing it before the reload stalls
the navigation itself and the banner never appears.

**Uploading documents locally (PHI scan):** a real document upload fails in this env with "We could not verify this document for PHI. Please try again in a moment." — the Vertex/Gemini scan fails closed because the local `GEMINI_API_KEY` is not usable. Two ways around it, both exercising the real server action:
- **Clean upload:** use a file whose *extracted* text is under 50 chars (`MIN_SCAN_LENGTH`) — the scanner returns `hasPHI: false` without calling the AI. `node_modules/pdf-parse/test/data/05-versions-space.pdf` (22 chars) is a ready-made tiny PDF; a `docx`-package DOCX with one short paragraph works too.
- **PHI-detected path:** ≥50 chars containing a high-confidence identifier (SSN / email / phone) — the deterministic local pre-pass in `phiScanner.ts` fails closed with zero network calls.
- PDFs generated with **pdfkit are unusable**: `pdf-parse@1.1.1` rejects them ("Illegal character: 41" / "bad XRef entry"), which surfaces as "Extraction Failed" in the UI and looks like an app bug. Also import it as `pdf-parse/lib/pdf-parse.js` in scripts — the package entry point reads a missing `./test/data/...` file when it has no parent module.

**Reaching a deep course-wizard step without re-running the upload:** the wizard restores from a
sessionStorage draft, so seed `lms_course_wizard_draft_v2` with
`{step, formData, generatedContent, savedAt: Date.now()}` (`selectedDocId` was dropped in Phase 6;
a `generatedContent` stub lands you on steps 7-9 without ever running the AI), reload, and
click "Resume Draft" — that lands on any step with real state, no step-2 PHI upload needed. Two
catches: the resume banner renders before hydration, so wait ~2.5s after it appears or the click is
a no-op and the step never changes; and `formData` must be a COMPLETE `CourseWizardData` (a
partial one renders but the Next gate misbehaves). Category ids come from the `course_categories`
table (`docker exec lms-dev-db psql -U postgres -d lms`), not `"CourseCategory"`.

**Script gotchas:**
- `browser.newPage({ viewport })` silently ignores the viewport — it is a **context** option.
  Use `browser.newContext({ viewport }).newPage()`, or the page renders at the default size and
  your responsive screenshots are all wrong.
- The login form needs ~2s after `waitForSelector('form')` before typing: during hydration the page briefly renders TWO email/password inputs, `.first()` hits the pre-hydration one, and the submit button never enables.
- `getByRole('button', {name: /log in/i})` is ambiguous (the Microsoft SSO button matches too) — use `button[type=submit]`.
- Put the script in the scratchpad with a **`.mts`** extension (tsx compiles `.ts` as CJS → "Top-level await is not supported") and symlink the repo's `node_modules` into the scratchpad dir so `playwright` resolves.
- `page.evaluate(fn)` fails with `ReferenceError: __name is not defined` under tsx — pass the body as a **string** instead.
- `page.fill()` on the login form does not enable the submit button; use `locator.pressSequentially()`.
- `npx playwright install chromium` may be needed (browser cache is often absent).
- The dashboard shell scrolls **inside** a container, not the window, so `screenshot({ fullPage: true })` captures only the viewport. `main` is NOT the scroller (it is `h-full` with the overflow on its last child) — grow the viewport to `main > div:last-child`.scrollHeight + header height instead.
- Log in **once** and reuse `storageState` across contexts; each scripted login burns a rate-limit attempt.
