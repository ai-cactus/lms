---
name: session-isolation-fix-verification
description: Verification of the SessionIdentityGuard fix (tab-eviction + resolveMembershipForActiveSession point-lookup) — a confirmed product gap (refocus-only detection doesn't work), a stale-mock test trap from the activeMembershipOf refactor, and a transient cold-start flake
metadata:
  type: project
---

Follow-up to [[session-isolation-repro-and-stale-generated-client]]. The render-level fix
(`src/components/providers/SessionIdentityGuard.tsx` + `src/lib/auth/tab-identity.ts`) and the
active-org point-lookup fix (`resolveMembershipForActiveSession` in `src/lib/auth/membership.ts`)
are BOTH confirmed working via e2e — `tests/e2e/session-isolation-repro.spec.ts` (REPRO A tightened
to assert `[data-testid="session-evicted"]` visible + body text excludes the other account's
name/org, not just `.toContain` the original account) and the new
`tests/e2e/session-active-org-isolation.spec.ts` (two separate `browser.newContext()`s = two
devices, same user, one switches active org via `/select-organization` → the other's next reload
still shows its OWN org, proving the layout no longer re-derives from the global
`lastActiveOrganizationId`).

**Confirmed product gap (NOT a test bug, reported not fixed):** `tests/e2e/session-identity-guard-focus.spec.ts`
fails deterministically (5/5 runs). `SessionIdentityGuard`'s own refocus listeners
(`window.addEventListener('focus', ...)`, `document.addEventListener('visibilitychange', ...)`,
lines ~85-97) only re-run the LOCAL `evaluate()` comparison of sessionStorage against the
`currentUserId` PROP — which is static, captured once at the last server-rendered page load. Firing
`focus`/`visibilitychange` without an actual reload/navigation never refreshes that prop (Next.js
App Router doesn't refetch RSC payload on focus by itself, and next-auth's own
`refetchOnWindowFocus` only updates `useSession()`'s data, which this guard doesn't consume) — so a
same-portal eviction that happens while a tab is merely backgrounded (not closed/reloaded) is
NOT detected until the tab is actually reloaded or client-navigates. The guard's own comment
("re-check when a backgrounded tab is brought back to the foreground: the eviction may have
happened while this tab was hidden") describes intent the current implementation doesn't deliver.
Fix would need either: SessionIdentityGuard consuming `useSession()`'s live data (comparing
`session.user.id` reactively) instead of the static prop, or the refocus handler triggering
`router.refresh()` before re-evaluating.

**Test-staleness trap found + fixed (test-only, not product):** `src/lib/create-auth-instance.ts`'s
this-session refactor moved `activeMembershipOf` out of the file (was a local function) into a
shared export on `@/lib/auth/membership.ts` (also needed by `session-bridge.ts`). Two test files —
`src/lib/create-auth-instance.test.ts` (15 failures) and
`src/lib/create-auth-instance.cache-integration.test.ts` (5 failures) — had
`vi.mock('@/lib/auth/membership', () => ({...}))` factories written BEFORE the refactor, listing
only the I/O-bound exports (`resolveActiveMembership`, `getActiveMembership`, `createMembership`,
`recordMembershipLogin`) and missing the newly-imported `activeMembershipOf`, so every authorize()/
jwt() path that called it threw `No "activeMembershipOf" export is defined on the mock`. Fixed by
switching both factories to the `async (importOriginal) => ({ ...actual, ...overrides })` pattern
and leaving `activeMembershipOf` REAL/unmocked (it's a pure function of the `resolution` shape the
mocked `resolveActiveMembership` already returns per-test, so mocking it too would just duplicate
the translation and risk drifting from the real implementation it's meant to verify the wiring of).
All 41 + 14 tests pass after the fix. **How to apply:** when a refactor moves a previously-local
pure function into an already-mocked module, check every `vi.mock` factory for that module — a
flat-object mock silently drops any newly-imported export instead of erroring at mock-definition
time, so it stays invisible until the code path that calls it actually runs.

**Transient flake observed, not reproduced after warm-up:** `session-active-org-isolation.spec.ts`
failed twice (both showing a FALSE eviction — device 1 got the "You've been signed out ... another
user" screen with an EMPTY stale name, i.e. `recorded.name` was `''` at write time) during the
FIRST few minutes after building+starting the prod server fresh (cold Redis connection / background
worker init). It then passed 15/15 consecutive runs afterward, including 3 repeats of the exact
batch (`session-isolation-repro.spec.ts` + `rbac-dual-cookie-login.spec.ts` +
`session-active-org-isolation.spec.ts` + `session-identity-guard-focus.spec.ts`,
`--workers=1 --retries=0`) that reproduced it once. Root cause not isolated — no code change was
made in response since it never recurred once the server was warm. If this resurfaces, suspect the
Redis-backed revalidation cache (`getCachedRevalidation`/`setCachedRevalidation`, keyed by raw
`token.id`) or a `switchOrganization()`/`recordMembershipLogin` timing interaction during
first-request JIT/connection-pool warm-up, not a fundamental logic bug — the same two-device
sequence has since run clean well over a dozen times.

**RE-VERIFIED 2026-08-23 after code-ninja's focus-fix landed** — `checkLiveTabIdentity` (new pure
helper in `tab-identity.ts`) + `SessionIdentityGuard` consuming `useSession()` (a second
`evaluateLive` path, refetched via `refetchOnWindowFocus` on the surrounding `SessionProvider`,
that can only ESCALATE to mismatch, never downgrade). `tests/e2e/session-identity-guard-focus.spec.ts`
now passes deterministically — 16/16 across 5 standalone runs + 3 four-spec-batch runs, confirming
the previously-reported gap is closed. Added 5 unit cases for `checkLiveTabIdentity` to
`tab-identity.test.ts` (unknown-when-no-baseline, unknown-not-match-with-live-id-but-no-baseline,
match, mismatch, mismatch-on-null-live-id) — 19/19 pass. `session-isolation-repro.spec.ts` (A+B)
and `rbac-dual-cookie-login.spec.ts` stayed 100% green throughout (20/20 batch runs) — the
first-paint/reload path is confirmed untouched by this change.

`session-active-org-isolation.spec.ts` reconfirmed the flake noted above, at a similar rate under
heavier sampling: **17/20 four-spec-batch runs passed (3 failures, ~15%)**, ALL with the identical
symptom (device 1 shows the eviction screen with an empty `staleName`, i.e. "You were viewing as
another user"), and **0/18+ standalone runs failed**. Made a dedicated attempt to catch it live —
added `sessionStorage`/cookie/reload-response-status debug logging and looped ~13 additional batch
runs specifically trying to reproduce it with instrumentation attached; it did not reproduce even
once under instrumentation (only reproduced 3 times total, all with the instrumentation absent).
This is strong evidence it's a **timing-sensitive race that the debug `page.evaluate()` calls
themselves perturb away** (extra round-trips shift the exact interleaving), not something
straightforwardly inspectable via added logging. **Confirmed this flake pre-dates today's product
diff** (it was already documented, at a similar rate, against the OLD SessionIdentityGuard
implementation before `checkLiveTabIdentity`/`useSession()` existed) — so it is unrelated to the
focus-detection fix and should NOT block accepting that fix. Left as an open, low-priority,
narrow-repro item; if picked up again, the next angle worth trying is a JS heap/CPU profile capture
across a looped batch run (not more logging) since logging itself seems to mask it.

**HARDENING ROUND 2026-08-23 — flake CONFIRMED STILL PRESENT, hardening incomplete.**
code-ninja hardened `checkLiveTabIdentity`: an absent/null live user id now resolves to `'unknown'`
(not `'mismatch'`), and `SessionIdentityGuard`'s `evaluateLive` only escalates to mismatch when
`sessionStatus === 'authenticated'` with a genuinely different id — this was aimed squarely at the
false-eviction flake above. Re-verified with a 26-run uninstrumented batch (`session-isolation-repro`
+ `rbac-dual-cookie-login` + `session-active-org-isolation` + `session-identity-guard-focus`,
`--workers=1 --retries=0`): **25/26 batch runs fully green (259/260 individual test passes), 1
batch run (#14) failed with the IDENTICAL symptom** — `session-active-org-isolation.spec.ts`,
`tests/e2e/session-active-org-isolation.spec.ts:177` (the `.toContain(ORG_X_NAME)` assertion),
device 1's header rendering the eviction screen with an empty `staleName` ("You were viewing as
another user") after device 2 (a separate context, SAME user, different org) switched orgs. Rate
dropped from ~15% to ~4% (1/26) but did NOT reach zero — **the hardening reduced but did not
eliminate the false eviction**, meaning either (a) the root cause is actually in the OLD,
UNTOUCHED prop-based path (`evaluate()`/`checkTabIdentity()` in `SessionIdentityGuard.tsx`, which
this round's fix did not touch — both the live and prop paths funnel into the same
`setStatus('mismatch')`/`staleName` state, so DOM text alone can't distinguish which path fired),
or (b) `evaluateLive`'s live-id-absence guard has a residual gap beyond the null/unauthenticated
case it now covers. Routed back to the orchestrator to send to code-ninja. **Also found and fixed a
bug in my OWN test**: `session-active-org-isolation.spec.ts` used
`locator.isVisible({timeout: 5000})` expecting it to poll/wait — it does NOT (Playwright's
`isVisible()` is a synchronous point-in-time check; only `waitFor({state:'visible', timeout})`
actually polls) — so an added "device 1 must not show the eviction screen" assertion was
silently a near-no-op in every prior run. Fixed to `waitFor(...).then(() => true).catch(() =>
false)`. The header-text assertions (which DO use Playwright's real auto-waiting via
`locator.innerText()`) were never affected by this and remain the reliable signal throughout.

**HARDENING ROUND 3 (confirm-before-evict) 2026-08-23 — flake ELIMINATED, 30/30 CLEAN.**
code-ninja's structural fix: `SessionIdentityGuard.tsx` no longer commits a computed mismatch (from
either `evaluate()`'s prop-based path OR `evaluateLive()`'s live-session path) immediately. It
schedules a single debounced re-check via `CONFIRM_EVICTION_DELAY_MS = 250`, re-reads the FRESHEST
live session + recorded baseline through refs (not the stale closure that computed the original
mismatch), and only commits `setStatus('mismatch')` if it still disagrees. This is the correct fix
for round 2's residual ~4%: it covers BOTH detection paths uniformly, which explains why round 2
(which only hardened the live-path's null-id case) left a residual — the false positive could
apparently arise transiently on either signal, not just an absent live id.

Re-verified with a **30-run uninstrumented batch, 0 failures, 300/300 individual test passes**:
`session-isolation-repro.spec.ts` (A+B) 60/60, `rbac-dual-cookie-login.spec.ts` 180/180,
`session-active-org-isolation.spec.ts` 30/30 (the flake this round targeted — clean sweep, versus
25/26 and 17/20 in the two prior rounds), `session-identity-guard-focus.spec.ts` 30/30 (confirms
the 250ms confirm-delay does NOT break genuine same-portal-takeover detection — a real takeover is
persistent and survives the re-check, exactly as designed). Exact re-run command:
```
DATABASE_URL="postgresql://postgres:0951@localhost:5433/lms_e2e?schema=public" \
npx playwright test tests/e2e/session-isolation-repro.spec.ts tests/e2e/rbac-dual-cookie-login.spec.ts \
tests/e2e/session-active-org-isolation.spec.ts tests/e2e/session-identity-guard-focus.spec.ts \
--workers=1 --retries=0 --reporter=list
```
This closes out the session-isolation investigation across all three hardening rounds — treat the
false-eviction flake as RESOLVED unless it resurfaces with fresh evidence.

**Infra notes for next time:** `lms_e2e` needed a full drop+recreate this session (a partial/older
seed had left a row whose `id` collided with the current `prisma/seed.ts`'s hardcoded UUID under a
different email, so `prisma.user.upsert({where:{email}, create:{id: ...}})` hit a unique-constraint
error on `id` even against an "empty-looking" DB) — `DROP DATABASE lms_e2e; CREATE DATABASE
lms_e2e;` then `migrate deploy` + `prisma generate` + `npx tsx prisma/seed.ts` from clean fixed it.
The `multi.org@test.com` / `MultiOrg123!` fixture (2 admin-tier memberships: `hr` in "E2E Test
Organization", `owner` in "E2E Second Organization") is reusable for any active-org-isolation
scenario — no new seed fixture needed. Also reconfirmed the KNOWN PRODUCT BUG documented in
`org-picker.spec.ts` (`recordMembershipLogin` called even on a `choice` resolution's provisional
first-joined default) is **already fixed** in the current code — `create-auth-instance.ts` line
~346 now gates it with `if (membership && resolution.kind === 'resolved')`. That spec's own comment
block describing the bug is now stale documentation of an already-fixed issue, not a live bug — did
not touch that file (out of this session's scope) but flagging so it isn't mistaken for still-open.
