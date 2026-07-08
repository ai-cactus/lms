---
name: signup-owner-only-e2e-env
description: e2e signup flow can run for real (MailHog SMTP wired up in dev); auth.spec.ts Microsoft/logout tests are pre-existing environment failures unrelated to code changes
metadata:
  type: project
---

Self-serve signup was simplified to owner-only (role-selection step removed; `signup()` in `src/app/actions/auth.ts` unconditionally persists `role: 'owner'` on the verification token — workers are only ever created via the invite flow).

**Dev SMTP is real, not stubbed.** `.env` sets `SMTP_HOST=localhost` / `SMTP_PORT=1025`, pointed at the `theraptly-mailhog` Docker container (part of the standard `docker ps` dev stack alongside `lms-dev-db` on 5433 and `lms-dev-redis` on 6380). This means Playwright specs can submit the real `/signup` form end-to-end (through the actual `signup()` server action and `sendEmailVerification`) without mocking — MailHog just accepts the SMTP handshake and swallows the mail. No need to bypass email via direct DB-insert for every signup-flow assertion; only do that when you specifically want to test `/api/auth/verify` in isolation (e.g. legacy/malformed token roles).

**`tests/e2e/auth.spec.ts` has two pre-existing failures, confirmed unrelated to any code change** (reproduced identically via `git stash` on the pre-change commit):
- `ENG-001` (Microsoft OAuth signup): `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_TENANT_ID` are empty in `.env` in this dev environment, so clicking the Microsoft button never fires the `microsoft-entra-id` POST the test waits for — 60s timeout.
- `ENG-002` (logout redirect): times out waiting for `**/dashboard` after logging in as `admin@test.com` / `Admin123!` — likely a stale/missing seed user for that persona post-RBAC-migration.

Neither is fixable by editing the spec; they need real Entra ID credentials / a corrected seed user respectively. Don't treat a red run of this file as a regression from unrelated work — check `git stash` against the base commit first if in doubt.

Related: [[Test Framework & Patterns]] project-test-framework.md.
