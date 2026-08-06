---
name: auth-revalidation-cache-ttl
description: JWT decode-time DB revalidation is Redis-cached (short TTL); sessionVersion-bump vectors are actively busted via invalidateRevalidationCache so they stay immediate, TTL backstops the rest.
metadata:
  type: project
---

The JWT `jwt()` callback in `src/lib/create-auth-instance.ts` caches its per-decode
DB re-validation in Redis (`src/lib/auth/session-revalidation-cache.ts`, key
`session-revalidate:<userId>`), TTL from `AUTH_REVALIDATE_TTL_SECONDS` (default 30,
`0` disables → always DB read). Reuses the shared `rateLimiterRedis` client.

**Why:** Tier 3 perf 5.1 (`docs/perf/tier3-implementation-plan.md` PR-4) — every
authenticated request was doing a `user.findUnique` per NextAuth instance.

**How to apply:**
- Active invalidation now makes the sessionVersion-bump vectors immediate again:
  `invalidateRevalidationCache(userId)` (in session-revalidation-cache.ts) is called
  right after every committed write that bumps `sessionVersion` — role change +
  removeStaff (staff.ts), token + forced password reset (auth.ts), self-service
  password change (user.ts). It `del`s `session-revalidate:<userId>` via
  `rateLimiterRedis`, is best-effort/fail-safe (try/catch → `logger.warn`, never
  throws), so the TTL stays the backstop if the bust fails.
- Vectors NOT actively busted still lag up to the TTL: user deletion (never cached —
  negative results aren't stored, so caught next decode anyway), role-not-permitted,
  org-null-admin defense-in-depth guard, and any raw-SQL/out-of-band mutation that
  skips the server action. That residual lag is the *approved* tradeoff — don't
  remove the cache; set TTL=0 for instant revocation everywhere.
- Two things are NOT subject to the lag and must stay that way: the retired-`admin`
  role guard (runs against the token BEFORE the cache lookup) and `signout-all`
  (`/api/auth/signout-all` deletes cookies directly, never touches this path).
- Per-session MFA state (`session-mfa:` keys, `isSessionMfaVerified`) is read
  fresh per decode and is intentionally NOT in this cache.
- Fail-open (F-036) preserved: a Redis miss/error falls back to the DB read; a DB
  error still returns the existing token. Never cache negative results, never
  cache sensitive fields (no password hash / MFA secret / tokens).
- If you add a new "kill live sessions now" mechanism, call
  `invalidateRevalidationCache(userId)` at the mutation site (after commit; per
  affected user for bulk writes) or accept the TTL lag. NOTE: e2e/tests that mutate
  the DB directly (raw SQL) bypass this bust — they must invalidate the key
  themselves or drive the real server action.

Related: org/role are authoritative on the resolved session — actions read
`session.user.organizationId` / `session.user.role` instead of re-querying (PR-5).
See [[auth-instance-vs-role]], [[rbac-role-model]].
