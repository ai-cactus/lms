---
name: mfa-2fa-consolidation-test-patterns
description: Test patterns for the 2FA email-OTP consolidation fix (mfa-session-stamp.ts, verify/send routes, mfa/verify page) — MailHog-based e2e OTP retrieval, dev-webServer hang, and disableMfa security-fix regression
metadata:
  type: project
---

Verified 2026-07-18 writing/running tests for the 2FA double-challenge fix
(root cause: `stampSessionMfaVerified` used to decode the session cookie with
`NEXTAUTH_SECRET` only; `create-auth-instance.ts` encrypts with
`AUTH_SECRET || NEXTAUTH_SECRET`, so whenever `AUTH_SECRET` was set and
differed — true in this dev environment — the stamp silently failed and
`proxy.ts` bounced the user to a second `/verify-2fa` challenge).

**`server-only` import crashes vitest for any new file under `src/lib/auth/`
that imports it** — same fix as `billing-prices.test.ts`:
`vi.mock('server-only', () => ({}))` at the top of the test file. Applies to
`mfa-session-stamp.test.ts`. See [[stripe-billing-prices-ssot-tests]].

**MailHog HTTP API is a viable, secret-free alternative to the DB-decrypt
OTP-reading pattern.** `GET {MAILHOG_URL}/api/v2/search?kind=to&query=<email-substring>`
returns matching messages newest-first. The body is quoted-printable encoded
(nodemailer's default for HTML with 8-bit content) — decode with
`.replace(/=\r?\n/g,'').replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
String.fromCharCode(parseInt(h,16)))` before regex-extracting the 6-digit
code (`/\b(\d{6})\b/` is safe against the HTML's other numeric literals —
pixel sizes, "15 minutes" — none of which are 6 digits). Track seen message
IDs in a `Set` across polls in the same test (enrollment send + login
step-up send both land in the same inbox) rather than assuming "newest" is
always the right one. This avoids the `NEXTAUTH_SECRET`-export-in-shell
requirement documented in [[mfa-e2e-enrollment-patterns]] for the DB-decrypt
approach — both are now valid; prefer MailHog when the spec doesn't already
need DB access for other reasons.

**A `next dev -p 3005` Playwright webServer can hang completely (0% test
progress, curl times out on every route, but the process itself spins at
100%+ CPU) with no error surfaced by Playwright** — distinct from the
already-documented [[e2e-webserver-dev-lock-conflict]] (which fails fast at
startup). This hang only shows up *after* the server reports ready and
Playwright starts running specs; `ps` shows real CPU usage so it looks
"alive," but `curl -sS --max-time 8 http://localhost:3005/login` returns
nothing. If a Playwright run stalls for minutes with near-zero incremental
CPU-time growth on the `playwright test` process itself (check `ps aux`
delta, not just "is it still running"), don't wait it out — `lsof -nP
-iTCP:3005 -sTCP:LISTEN` to find the stuck `next-server`, `kill -9` both it
and its `next dev` parent, confirm the port is clear, and re-run. Root cause
undiagnosed (not a product bug — the same specs pass cleanly on a fresh
server); treat as a flaky local dev-server condition to detect and restart
past, not something to "fix."

**Rate-limit e2e testing without `E2E_TEST_BYPASS_RATE_LIMIT`:** the
MFA-send limiter (`checkRateLimitOnly('mfa-send:${userId}', 3, 900,
{failClosed:true})` in `sendLoginMfaCode`) is keyed by userId, not IP, so a
freshly-seeded user's budget is untouched regardless of how many other specs
ran before it — no bypass flag needed, just don't exceed 3 sends /
5 verify-attempts within one test. To reach the budget quickly without
waiting out the UI's 60s resend cooldown: fire 2 extra sends directly via
`page.request.post('/api/auth/mfa/send', {data:{challenge}})` (bypasses the
component's cooldown state, shares cookies with the page), then `page.reload()`
to re-trigger the mount effect's real send — this drives the 4th
(over-budget) send through the actual component code path so the UI error
state is genuinely exercised, not just a raw fetch returning 429.

**Recreating "both admin+worker cookies present" at MFA-verify time requires
re-injecting the sibling cookie mid-flow.** A normal admin login already
clears any pre-existing worker cookie via the ISSUE 4 `signIn` callback
sibling-clear (see [[org-facility-split-test-patterns]]-adjacent
`rbac-dual-cookie-login.spec.ts`) *before* the MFA challenge page is even
shown — so by the time OTP verification happens, the worker cookie is
already gone. To genuinely test that `stampSessionMfaVerified` picks the
instance from `challengeData.role` and not by inspecting which cookies are
on the request, capture the worker cookie value before the admin login, then
`context.addCookies([{name:'worker.session-token', value, domain:'localhost',
path:'/', httpOnly:true, sameSite:'Lax'}])` after landing on `/mfa/verify`
but before submitting the code. This is a real, necessary technique for this
codebase's login-clears-sibling design — not a workaround for a test
limitation.

**`disableMfa()` security-fix regression pattern:** the bug was `if
(!isValid)` gating on the whole `{valid, error}` object (always truthy) —
fixed to gate on `.valid`. Test with a real encrypted-but-wrong OTP (via
`encryptOtpPayload` from `@/lib/mfa`, actual/unmocked) so `verifyUserMfaCode`
falls through to its genuine "no match" path, not a mocked short-circuit —
proves the fix against the actual comparison logic. For the recovery-code
branch, use a REAL low-cost `bcrypt.hash(code, 4)` (via a dynamic `import('bcryptjs')`,
left unmocked) rather than stubbing `bcrypt.compare`, since `@/lib/mfa`'s
`verifyRecoveryCode` is the actual (unmocked) implementation in this test
file's `vi.mock('@/lib/mfa', async () => ({...actual, hashRecoveryCode:
mock}))` partial-mock pattern (only `hashRecoveryCode` is stubbed, to avoid
paying real bcrypt-12 cost for the *setup* flow's 10 codes — `verifyRecoveryCode`
is untouched, so seeding a fake hash string would never match).

Related: [[mfa-e2e-enrollment-patterns]], [[rtl-strictmode-double-invoke-gotcha]],
[[e2e-webserver-dev-lock-conflict]], [[project-test-framework]].
