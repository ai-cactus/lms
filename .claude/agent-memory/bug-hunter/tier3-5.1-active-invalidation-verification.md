---
name: tier3-5.1-active-invalidation-verification
description: Tier 3 5.1 auth revalidation Redis cache — the test suite (unit + cache-integration + session-org-scoping files), the 30s-TTL e2e regression and its 66aa961 invalidateRevalidationCache() fix, the TTL-fake-timer technique, fail-safe coupling and snapshot-allowlist gaps
metadata:
  type: project
---

Tier 3 5.1/5.2 (`56a3eab`/`7c4a489`) added a short-TTL Redis cache in front of
the JWT `jwt()` callback's DB revalidation (`src/lib/auth/session-revalidation-cache.ts`)
and made several server actions read `organizationId`/`role` straight off the
session. The first test round found a live-e2e regression: the cache made
`tests/e2e/rbac-removed-staff-login.spec.ts`'s "killed on next navigation" test
fail at the default 30s TTL. `code-ninja` fixed it in commit `66aa961` by adding
`invalidateRevalidationCache(userId)`, called immediately after every
`sessionVersion`-bumping write (`staff.ts` role-change + `removeStaff`,
`auth.ts` both password-reset paths, `user.ts` `changePassword`). **This round
re-verified the fix and closes out 5.1 — everything is green.**

**Unit/integration files covering the cache (from the first round):**
- `src/lib/auth/session-revalidation-cache.test.ts`: TTL env parsing, TTL=0 skips
  Redis, corrupted-JSON entries fail safe, Redis errors swallowed and logged,
  exact 8-field snapshot shape.
- `src/lib/create-auth-instance.cache-integration.test.ts`: the REAL cache module
  behind an in-memory fake Redis, wired into the real `jwt()`. It is the only file
  that exercises a cache HIT. The plain `create-auth-instance.test.ts` mocks
  `@/lib/rate-limit` down to `checkRateLimit`, so every cache read there throws
  internally, is swallowed, and falls back to the DB.
- `src/lib/create-auth-instance.test.ts`: explicit `getCachedRevalidation` /
  `setCachedRevalidation` mocks (defaulting to always-miss), plus cache-hit-skips-DB
  and snapshot-shape-at-the-real-call-site blocks.
- `src/app/actions/{course,enrollment,user}.session-org-scoping.test.ts`: assert
  every prisma `where` is scoped to the session's `organizationId`. They also
  assert that an org-less session never issues an unscoped or
  `organizationId: null` query, which would match other orgs' rows.
- `course-publish-gate.test.ts`: its session mock needed `organizationId` once
  the action stopped re-querying the user. That was a stale test double, not a
  product bug.

**Open hardening gap (not exploitable today):** the cache module does a bare
`JSON.stringify(snapshot)` with no runtime field allowlist. It is safe only
because the single call site passes an object literal built from a
`prisma.select` that never fetches `password`. A future caller that passes a
variable, such as a spread full user record, would bypass both protections
silently.

**E2E fix (the actual deliverable):** the old test used raw-SQL
`simulateRemoveStaff()`, which bypasses every server action and so can never
observe active invalidation. Rewrote it to drive the real `removeStaff()`
action through the UI (two browser contexts: HR session stays live, a separate
owner session removes them via `/dashboard/staff` → Row actions → Remove
Staff), confirmed passing in 7.2s at the **unset/default** TTL. Added a
companion contrast test using the now-repurposed `simulateRemoveStaff()` (raw
SQL, deliberately never calls the invalidation function) proving an
out-of-band bump does NOT kill the session immediately — session stays alive
right after the raw write. Both live in
`tests/e2e/rbac-removed-staff-login.spec.ts`.

**TTL-backstop test technique (new, reusable):** rather than a real 30s e2e
sleep (slow, and the shared reused local webServer's TTL isn't overridable
per-test), extended the fake Redis in
`src/lib/create-auth-instance.cache-integration.test.ts` to track a real
per-key expiry timestamp (honors the `EX` seconds passed to `set`) and added a
`TTL backstop vs. active invalidation` describe block using `vi.useFakeTimers()`
+ `vi.advanceTimersByTime()` with a short (2s) configured TTL. Proves BOTH
halves deterministically and fast: an out-of-band bump with no invalidation
call stays masked until the (short, virtual) TTL elapses then self-heals; the
same bump WITH `invalidateRevalidationCache()` is caught immediately with zero
time advanced. This is the reusable pattern for any future "prove a cache
self-heals after N seconds" test — don't reach for a real sleep.

**Fail-safe coupling observation (not currently exploitable, worth a heads-up
if touched again):** none of the 5 call sites (`updateStaffDetails` role
change, `removeStaff`, `resetPasswordWithToken`, `forceResetPassword`,
`changePassword`) wrap `invalidateRevalidationCache()` in their own local
try/catch — they rely entirely on that module's documented "never rethrows"
internal contract. Pinned this with a deliberately contract-violating mock in
`staff.test.ts` (`removeStaff` — see the "OBSERVATION" test): if
`invalidateRevalidationCache` ever did throw, `removeStaff`'s single top-level
try/catch would report `{success:false}` even though its `$transaction` had
already committed — a false-negative UX bug (staff actually removed, admin
sees an error). Contrast: the email-notification block a few lines below IS
independently try/caught for exactly this reason. Not a bug today (the real
function never throws), but a latent trap if that contract ever regresses.

**New local-e2e env gotcha (beyond the existing [[e2e-local-auth-url-env-trap]]):**
booting the dev server locally against `lms_e2e`/Redis 6380 additionally needs
`SMTP_USER` + `SMTP_PASSWORD` set (not just `SMTP_HOST`/`SMTP_PORT`) — `src/lib/env.ts`'s
boot-time validation rejects an incomplete email-transport config and the
server fails to start entirely (`instrumentation.ts` throws). Mirror the full
CI e2e env block's dummy values (`SMTP_USER=ci@example.com`,
`SMTP_PASSWORD=ci_dummy_password`) even for a local run that only needs
MailHog for delivery, not credentials.

**Full regression run:** the adversarial 5.1 suite (10 files: the two auth
mock-cache files, `create-auth-instance.test.ts`, the 3 session-org-scoping
files, `course-publish-gate.test.ts`, and the 3 files touched this round —
`staff.test.ts`/`auth.test.ts`/`user.test.ts`) — 198/198 green. Full project
suite — 2263/2263 green, no regressions from this round's changes.

See [[e2e-local-auth-url-env-trap]], [[e2e-webserver-dev-lock-conflict]].
