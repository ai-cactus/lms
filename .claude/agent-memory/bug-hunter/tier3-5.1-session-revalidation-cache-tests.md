---
name: tier3-5.1-session-revalidation-cache-tests
description: Auth revalidation Redis cache (session-revalidation-cache.ts) test suite + a confirmed LIVE e2e regression — default TTL breaks the "removed staff session dies on next navigation" guarantee
metadata:
  type: project
---

Tier 3 5.1/5.2 (branch `feat/more-performance`, commits `56a3eab`/`7c4a489`) added a
short-TTL Redis cache in front of the JWT `jwt()` callback's DB revalidation
(`src/lib/auth/session-revalidation-cache.ts`), and made several server actions
read `organizationId`/`role` straight off the session instead of re-querying.

**Confirmed BLOCKING finding (live e2e, not just unit-mocked):** with the
default `AUTH_REVALIDATE_TTL_SECONDS` (30s, unset in `.env`/`.env.example`
default and NOT overridden in CI's e2e env block either), the existing
`tests/e2e/rbac-removed-staff-login.spec.ts` test **"a live HR session is
killed by removeStaff() — the next navigation redirects to /login"** now
FAILS — the removed staffer stays on `/dashboard` instead of being redirected,
because the cache still holds the pre-removal snapshot (unchanged
`sessionVersion`/`organizationId`) and the `jwt()` callback never reaches the
DB read that would catch the removal. Confirmed the cache is the cause (not a
flake) by rerunning with `AUTH_REVALIDATE_TTL_SECONDS=0`: passes clean in
9.8s. This directly contradicts the pre-existing, documented "invalidated on
its next JWT decode" guarantee that spec encodes — the implementer's own
"bounded to ≤TTL" framing understates the impact: it turns an existing
next-navigation guarantee into a real up-to-30s live-access window after
password reset, role change, or org removal (all three funnel through the
same `sessionVersion` check in `jwt()`, confirmed via `staff.ts`/`auth.ts`).
Since CI's e2e env block doesn't set `AUTH_REVALIDATE_TTL_SECONDS` either,
merging this to a branch with e2e in CI would make this same spec fail there.

**Repro recipe** (useful for future TTL-sensitive e2e work): local e2e against
`lms_e2e` (5433, `0951`) + Redis on `6380` (not the CI default 6379) + the full
CI e2e env block from `.github/workflows/ci.yml` (~line 247) adapted for local
ports, per [[e2e-local-auth-url-env-trap]]. Toggle
`AUTH_REVALIDATE_TTL_SECONDS=0` vs unset to isolate cache-caused failures from
everything else.

**Unit/integration coverage added** (all green, 2248/2248 full suite):
- `src/lib/auth/session-revalidation-cache.test.ts` — pure unit tests: TTL env
  parsing edge cases, TTL=0 skips Redis entirely, corrupted-JSON cache entries
  fail safe (not thrown), Redis get/set errors swallowed + logged, exact
  8-field snapshot shape. One documented (not asserted-failing) gap: the
  module does a bare `JSON.stringify(snapshot)` with no runtime field
  allowlist — safe today only because the one real call site passes an object
  LITERAL (TS excess-property check) built from a `prisma.select` that never
  fetches `password`; a future call site passing a variable (e.g. spreading a
  full Prisma user record) would bypass both protections silently. Worth
  hardening but not currently exploitable.
- `src/lib/create-auth-instance.cache-integration.test.ts` (NEW) — wires the
  REAL cache module (not mocked) behind an in-memory fake Redis into the real
  `jwt()` callback. This is the one that actually exercises a cache HIT — the
  pre-existing `create-auth-instance.test.ts` mocks `@/lib/rate-limit` down to
  just `checkRateLimit`, leaving `rateLimiterRedis` undefined, so every cache
  read there throws internally and is silently swallowed → it always falls to
  the DB by accident and never tests a real hit. Proves all 7 numbered claims
  at the composition level except claim 7 (covered in the unit file) and claim
  6-in-isolation (also re-pinned via mocks in `create-auth-instance.test.ts`).
- `src/lib/create-auth-instance.test.ts` — extended with an explicit
  `getCachedRevalidation`/`setCachedRevalidation` mock (defaulting to
  always-miss, preserving all 21 pre-existing tests' DB-path behavior) plus
  new describe blocks for cache-hit-skips-DB, exact-snapshot-shape-at-the-real-call-site,
  and retired-admin-guard-runs-before-cache-lookup.
- `src/app/actions/course.session-org-scoping.test.ts`,
  `enrollment.session-org-scoping.test.ts`, `user.session-org-scoping.test.ts`
  (all NEW — `getCourses`/`getCourseForOrgView`/`assignRetake`,
  `getAvailableUsers`/`getCourseAssignmentSettings`/`getRoleHolderCounts`,
  `getStaffUsers`/`searchStaffUsers` had ZERO pre-existing tests despite being
  touched by PR-5) — assert the actual prisma `where` clause is scoped to the
  session's `organizationId` per-call (two different org sessions in the same
  suite must never cross-query each other's org), that an org-less session
  never issues an unscoped/`organizationId: null` query (a real leak vector —
  `null` would match every other org's removed/pending users), and that
  admin-only gates reject a worker-tier role AND the retired `admin` role
  sourced from the session (defense-in-depth: `isAdminRole` already excludes
  `'admin'` post-RBAC-migration).

**Real regression caught in a file the implementer missed**:
`src/app/actions/course-publish-gate.test.ts` (pre-existing, NOT one of the 4
spec files the implementer updated) calls `createFullCourse` with a session
mock lacking `organizationId` and relied on the now-removed
`prisma.user.findUnique` re-query for it — broke with "Organization not
found" on all 3 tests. Fixed the test double (added `organizationId: 'org-1'`
to the session mock), same pattern already applied in the 4 files the
implementer did update. This was a stale test double, not a product bug — the
org-from-session change itself is correct.

See [[e2e-local-auth-url-env-trap]], [[e2e-webserver-dev-lock-conflict]].
