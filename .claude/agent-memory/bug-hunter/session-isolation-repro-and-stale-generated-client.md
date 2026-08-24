---
name: session-isolation-repro-and-stale-generated-client
description: New spec proving the shared-cookie-jar view-bleed/eviction-render bug at the render level; a distinct "generated/prisma stale relative to schema.prisma" trap that breaks ALL logins, not the AUTH_URL trap
metadata:
  type: project
---

`tests/e2e/session-isolation-repro.spec.ts` — REPRODUCTION-ONLY spec (2 tests) proving the
render-level symptom of the admin/worker shared-cookie-jar design, on top of the cookie-clearing
behavior already covered (and already fixed) by `rbac-dual-cookie-login.spec.ts`'s ISSUE 4 tests.
Both tests assert the DESIRED isolated behavior and FAIL on the current build — that failure is
the intended reproduction evidence, not a spec bug. Do not "fix" the assertions.

- **REPRO A (same-portal view bleed)**: two admin accounts (different orgs, `owner` + `finance`
  roles) in one browser context/two tabs. Tab 2 logging in as B silently overwrites tab 1's
  rendered identity on reload — tab 1 goes from showing A to showing B with zero action of its
  own. Confirmed reproducing: tab 1's header goes from "Alice Anderson" to "Bob Baxter" after B's
  tab-2 login + tab-1 reload.
- **REPRO B (cross-portal render)**: admin A in tab 1, worker B logs in via tab 2 (which — per
  the already-fixed ISSUE 4 behavior — clears A's `admin.session-token`). Tab 1 then navigates to
  `/worker` (a portal it was never in) and silently renders B's identity ("Dave Dalton") instead
  of any evicted-session state. Confirmed reproducing.

Identity is captured by reading `<header>` text — both `src/app/dashboard/(main)/layout.tsx` and
`src/app/worker/layout.tsx` resolve the session server-side and pass `fullName`/role down into a
component that renders inside `<header>`, so this is a faithful "who does the server think this
tab is" probe with no client-side caching involved. Seed accounts with distinct
firstName/lastName so the header text is unambiguous per account (the existing
`rbac-dual-cookie-login.spec.ts` seeds every account as "Dual Cookie", which works there because
it never needs to tell two accounts apart on screen).

**New, distinct env trap found this session — NOT the known [[e2e-local-auth-url-env-trap]] or
[[e2e-webserver-dev-lock-conflict]]:** `generated/prisma` (this repo's custom Prisma Client output
path, per `prisma/schema.prisma`'s `generator client { output = "../generated/prisma" }`) can be
older than the actual `.prisma` schema files (confirmed: client dir mtime Aug 19, schema files
Aug 20 — a day of drift after a branch checkout/rebase that changed schema without anyone running
`prisma generate`). Symptom: **every** login (both admin and worker) 500s with `TypeError: Cannot
read properties of undefined (reading 'findMany')` at `listActiveMemberships` /
`prisma.organizationUser.findMany` — the client's TS types/runtime don't know about a model added
in a schema change (here, `OrganizationUser` from the multi-org-membership migration) even though
the DB itself has the table. `npx prisma migrate deploy` does NOT regenerate the client — only
`npx prisma migrate dev` or an explicit `npx prisma generate` does. **How to apply:** before any
local e2e run, especially after a `migrate deploy` against a target DB, run `npx prisma generate`
first and confirm the dev server was (re)started after — Turbopack's dev server does pick up the
regenerated client, so no `.next` cache wipe was actually needed here (the `rm -rf .next` I
reached for was blocked by the sandbox's destructive-command guard and turned out unnecessary; a
plain restart after `prisma generate` was sufficient).

**lms_e2e DB was 5 migrations behind `lms` in this session** (missing
`20260803120000_multi_org_membership` and 4 later ones) — `npx prisma migrate deploy
DATABASE_URL=...lms_e2e...` brought it current with no data loss (empty target DB, so no
seed-fixture concerns). Both `lms` and `lms_e2e` local DBs can independently drift from the
current schema depending on which branch's migrations were last applied against which — always
run `prisma migrate status` against whichever DB you're about to point the server at, not just
`lms_e2e` by convention.

Also reconfirmed [[local-main-line-preview-recipe]]'s note that `.env` lacks `GOOGLE_PROJECT_ID`
and `SMTP_USER`/`SMTP_PASSWORD` (both commented out), which makes `src/lib/env.ts`'s
`validateEnv()` throw at instrumentation-hook load and crash the dev server before it ever binds
the port. Dummy values (`GOOGLE_PROJECT_ID=theraptly-lms-e2e-dummy`,
`SMTP_USER=e2e-dummy@example.com`, `SMTP_PASSWORD=dummy-not-used`) are sufficient to pass
validation for a login/session-focused spec that never touches Vertex AI or email — no MailHog
container was needed for this spec at all (no OTP/MFA flow).
