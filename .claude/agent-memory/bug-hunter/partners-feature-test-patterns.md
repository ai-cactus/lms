---
name: partners-feature-test-patterns
description: Unit + e2e test patterns for the /partners page, submitPartnerApplication action, and sendPartnerApplicationEmail — plus a Docker-free local SMTP stub technique for e2e runs
metadata:
  type: project
---

Added for the `/partners` marketing feature (branch `feat/partners`): `src/app/actions/partners.test.ts` (new), `sendPartnerApplicationEmail` tests appended to `src/lib/email.test.ts`, and `tests/e2e/partners.spec.ts` (new). All 18 unit tests + full repo vitest suite (107 files / 1469 tests) and all 7 e2e tests passed.

**No-Docker local SMTP stub.** This sandbox has no `docker` CLI at all (not just a stopped daemon), so the project's normal MailHog e2e sink (`SMTP_HOST=localhost:1025`, per [[e2e-local-verification-runbook]] and `tests/e2e/signup-email-verification.spec.ts`) isn't available. Wrote a ~40-line raw `net`-module SMTP stub (EHLO/MAIL FROM/RCPT TO/DATA/QUIT, no STARTTLS/AUTH advertised so nodemailer never tries to upgrade) to the scratchpad, ran it on 127.0.0.1:1025, and exported `SMTP_HOST=localhost SMTP_PORT=1025 SMTP_USER=... SMTP_PASSWORD=...` before `npx playwright test` — Playwright's webServer inherits the parent shell's env, so `next dev` picks up the stub instead of the real Zoho creds in `.env`. Confirmed the stub accepts a real nodemailer send before trusting it for the suite. **Why this is safe:** `/`, `/partners`, and the server action's own `recordEmailMessage()` DB write are best-effort/swallowed-on-error (see `sendMailTracked` in `src/lib/email.ts`), so the happy-path e2e test reaches the success state even with Postgres unreachable too — only the SMTP leg is load-bearing for that assertion.
**How to apply:** reuse this stub pattern whenever a Playwright test needs a real (non-mocked) email send to complete in this sandbox and Docker/MailHog isn't running. Real MailHog is still what CI uses per `.github/workflows/ci.yml`'s `e2e` job env block — this is a substitute, not a replacement.

**Two locator gotchas hit while running against the real page (both test bugs, not product bugs, fixed in the spec):**
- `getByRole('alert')` also matches Next.js's own `<div role="alert" aria-live="assertive" id="__next-route-announcer__">` on every page — always `.filter({ hasText: ... })` or scope to the form when asserting on an app-rendered alert.
- `getByText('Founding partners')` in the `FoundingPartner` section matched both the "Founding partners" badge span AND the pull-quote paragraph containing the lowercase phrase "founding partners" — needed `{ exact: true }`.

**Public-route DB independence confirmed:** `src/proxy.ts`'s `ROUTE_CONFIG` only gates `/worker*` and `/dashboard*` — `/` and `/partners` skip auth entirely, so rendering/navigation/calculator/validation e2e assertions need no DB or seeding at all, only the happy-path email-submit test needs a working SMTP sink.

See also [[wsl2-playwright-browser-install]], [[e2e-local-verification-runbook]], [[e2e-webserver-dev-lock-conflict]].
