---
name: local-dev-env-access
description: How to reach the local dev LMS, its Postgres DB, and MailHog for QA runs without real email round-trips
metadata:
  type: reference
---

**App:** `http://localhost:3000` (Next.js dev server, `npm run dev`).

**Database:** Docker container `lms-dev-db`, Postgres at `localhost:5433`, db `lms`. Connect with `PGPASSWORD=0951 psql -h localhost -p 5433 -U postgres -d lms` (password confirmed working 2026-07-06; check `.env.local`'s `DATABASE_URL` if it ever changes). **Column names are snake_case in the actual DB** even though Prisma models/fields are camelCase in code — e.g. query `organization_id`, `email_verified`, `expires_at`, `invited_by`, not the camelCase Prisma names. `\dt` to list tables; key ones for RBAC/invite QA: `organizations` (has `join_code`/`join_code_expires_at` columns), `users`, `profiles` (joined via `profiles.id = users.id`, NOT a `user_id` column), `invites` (`token`, `status`, `role`, `expires_at`, `created_at`).

**MailHog:** UI/API at `http://localhost:8025`, container `theraptly-mailhog`, captures ALL app email in this environment — no real email round-trips needed for verification links, invite links, or password-reset links. A helper script may exist per-session at a scratchpad path like `mailhog_links.py <email> [subject-filter]` that prints extracted links from emails to that address — check the current session's scratchpad path rather than assuming a fixed location, since scratchpad paths are session-scoped.

**Getting a password for a pre-existing account with an unknown password:** use `/forgot-password` → enter the email → fetch the reset link from MailHog → `/reset-password?token=...` → set a new password. Confirmed working cleanly end-to-end 2026-07-06 (no issues, no rate-limit hit for a single reset).

**Fresh self-signup flow on local dev matches the production 3-step pattern** (see [[production-env-access]] for the general shape) but with a local twist: `/signup` (name/email/password/confirm/terms) → `/signup/role-selection` (choose "Health Service Provider (Admin)" vs "Worker") → `/verify-email` interstitial → MailHog link → `/api/auth/verify?token=...` (307) → `/verify?token=...` "Welcome to Theraptly" page → click "Verify Email Address" → `/login?verified=true`. Choosing "Worker" at role-selection and having no organizationId yet lands the verified user on `/worker` showing a "Join your Organization" 6-digit-code entry screen (see [[rbac-role-grant-matrix]] for what happens after entering a code).

**Gotcha — stale browser session bites signup testing:** if a `playwright-cli` session is already authenticated as some other user when you navigate to `/signup` and submit, the submission can silently no-op (form appears to submit but no new user is created, and you get redirected using the *existing* stale session instead) — always `cookie-clear` + `localstorage-clear` (or use a brand-new session) before testing a fresh signup in a session that was previously used to log in as someone else.
