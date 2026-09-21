---
name: rbac-8-worker-role-split
description: Test patterns and gotchas from migrating RBAC tests off the single 'worker' role to the 8-worker-role category model (14 roles total)
metadata:
  type: project
---

Verified 2026-07-06 on branch `rbac`: the single `worker` DB role was replaced by 8 job-specific `category:'worker'` roles (`psychiatrist_prescriber`, `nurse`, `therapist_clinician`, `case_manager`, `behavioral_health_technician`, `peer_support_specialist`, `front_desk_admin`, `facilities_support`), all sharing one identical permission ceiling. `Role` (`permissions.ts`) gained a `category: 'manager' | 'worker'` field. `ALL_ROLES` is now 14 entries (6 manager, including the re-added `admin`, + 8 worker). `DEFAULT_SELF_SERVE_WORKER_ROLE = 'front_desk_admin'` is the fallback used wherever a worker account is created without an explicit job category (self-signup, invalid/stale invite role, CSV bulk-import default, onboarding step-4 bulk invites).

**Unknown or stale role keys are least-privilege denies.** `can(undefined, …)`
returns false, and `authorize.ts` logs `[rbac] Unknown or stale role — denying`.
They used to throw a `TypeError`. Still use real DB role literals (e.g. `'nurse'`)
in fixtures, not the retired `'worker'` string.

**Test fixtures using literal `'worker'` for a "worker DB role" are NOT necessarily broken — check whether the value flows through `can()`/`dbRoleToRoleKey`.** Many pre-existing test files (`create-org.test.ts`, `offering.test.ts`, `recipients.test.ts`) used `role: 'worker'` purely as a generic "some non-admin caller" fixture, checked only via `isAdminRole()` (which returns `false` for `'worker'` both before and after the split — it was never in `ADMIN_ROLES`). These continued to pass at runtime with zero code changes; only `tsc` on the *typed* call sites (function params literally typed `UserRole`) caught the drift. Don't assume every `'worker'` grep hit is a live bug — trace whether it reaches `dbRoleToRoleKey`/`can()` (denied, per above) or a DB enum insert (fails, since `'worker'` is no longer a valid `UserRole` value) before deciding it needs a behavioral fix vs. a cosmetic one.

**`verification_tokens.role` and `StaffEntry.role` (CSV import) are untyped `String`/coarse tokens, not the `UserRole` enum** — so literal `'worker'`/`'admin'` values compile fine and don't crash there; they get resolved downstream (`/api/auth/verify` validates against `ALL_ROLES` and falls back to `DEFAULT_SELF_SERVE_WORKER_ROLE`; `enrollUsers` CSV import maps `'admin'→'supervisor'`, everything else→`DEFAULT_SELF_SERVE_WORKER_ROLE`). Regression tests for these paths must assert the *resolved* DB role (e.g. `'front_desk_admin'`), not echo the coarse input token back.

**e2e specs under `tests/e2e/` seed users via raw `INSERT INTO users (..., role, ...) VALUES (..., $n::"UserRole", ...)`** — a literal `'worker'` there is a real Postgres enum cast and WILL fail at runtime post-migration (not just a stale assertion). Found and fixed in `rbac-roles.spec.ts`, `rbac-facility-tab.spec.ts` (unused, only the type union was stale), `rbac-invite-roles.spec.ts` (role-selector option-name assertions used a generic `/worker/i` regex — now meaningless since none of the 8 new roles' displayNames contain the word "worker", e.g. "Nurse", "Case Manager"). Also found in `signup-email-verification.spec.ts`: an AC-5 test asserted a *legacy* token role (`'admin'`) round-trips unchanged through `/api/auth/verify` — that's now actively wrong, since verify.ts's fallback logic (added this migration) maps any role not in `ALL_ROLES` to `DEFAULT_SELF_SERVE_WORKER_ROLE`; rewrote as two tests: real founder signup (`role:'owner'`) round-trips correctly, and a legacy/stale token role safely falls back rather than persisting an invalid enum value. None of these e2e specs were executed live (would need the app + migrated DB running); fixed for compile/logical correctness against current source only.

Related: [[org-facility-split-test-patterns]].
