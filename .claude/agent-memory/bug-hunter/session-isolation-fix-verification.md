---
name: session-isolation-fix-verification
description: Full verification arc of the SessionIdentityGuard session-isolation fix across 4 hardening rounds — the confirm-before-evict design, the CI regression it caused, and the clearTabIdentity()-on-/login fix that resolved it. All 0 failures as of the final round.
metadata:
  type: project
---

`SessionIdentityGuard` (`src/components/providers/SessionIdentityGuard.tsx`) + `tab-identity.ts`
(`src/lib/auth/tab-identity.ts`) guard against the render-level half of a session-isolation bug:
the admin/worker session cookies are shared per browser context, so a second account signing in
anywhere overwrites the cookie, and an untouched tab would otherwise silently re-render as the new
account. The guard records a per-tab baseline (`sessionStorage`) and evicts (shows
`SessionEvictedScreen`, `data-testid="session-evicted"`) when the server-resolved/live identity
disagrees with that baseline.

**This went through 4 verification rounds, each finding a real gap, each fixed:**

1. **Round 1 (focus-detection gap):** the guard only re-checked on refocus against a STATIC
   `currentUserId` prop (frozen at last SSR render) — firing `focus`/`visibilitychange` without an
   actual reload never detected a same-portal takeover. Fixed by adding `checkLiveTabIdentity` +
   `SessionIdentityGuard` consuming `useSession()` (refetched on window focus by `SessionProvider`).
   New spec: `tests/e2e/session-identity-guard-focus.spec.ts`.

2. **Round 2 (false-eviction, ~15%):** the live-session check treated an ABSENT/null live user id
   (e.g. a focus-triggered `/api/auth/session` refetch momentarily reading empty under CPU
   contention) as `'mismatch'`, spuriously evicting a still-valid tab. Fixed:
   `checkLiveTabIdentity` returns `'unknown'` (not `'mismatch'`) when the live id is
   absent/null/undefined/empty; `mismatch` requires POSITIVE evidence (a present, different,
   authenticated id). Rate dropped ~15% → ~4% but did not reach zero.

3. **Round 3 (confirm-before-evict, closed the ~4% residual):** the residual came from EITHER
   detection path (prop-based `evaluate()` or live `evaluateLive()`) computing a transient mismatch
   that a bare null-check didn't cover. Fixed structurally: a computed mismatch from either path is
   no longer committed immediately — it schedules a single debounced re-check after
   `CONFIRM_EVICTION_DELAY_MS = 250`ms (re-reading the FRESHEST live session + baseline via refs,
   not the stale closure) and only renders the eviction if it still disagrees. A genuine takeover is
   persistent and survives the 250ms window; a transient race resolves back to a match.
   **Verified 30/30 clean batch runs, 0 failures, 300/300 individual test passes.**

4. **Round 4 (CI regression from round 3's fix, on branch `bugfix/session-isolation`):**
   confirm-before-evict also blocked LEGITIMATE same-tab account switches — a common test-helper
   pattern in this repo's own e2e specs (`loginAs(admin2)` then `loginAs(admin)` on the SAME
   page/tab, e.g. `documents.spec.ts`'s "admin2 sees the document uploaded by admin1, and vice
   versa"; `reminders.spec.ts`'s TC-015 admin→worker same-context flow). The guard correctly saw a
   different account after the second login but the STALE per-tab baseline (from the FIRST login)
   made it look like a takeover of the SAME tab, not a legitimate re-auth. Fixed: `src/app/(auth)/login/page.tsx`
   now calls `clearTabIdentity()` on mount — reaching `/login` means THIS tab is (re)authenticating,
   so its baseline is void; the post-login landing page becomes `'first-sight'` (adopts the new
   account) instead of a false takeover. Because `sessionStorage` is per-tab, this clears ONLY the
   tab performing the login — a stale OTHER tab that never revisited `/login` keeps its baseline and
   still correctly evicts on its next reload/focus, preserving takeover detection.
   **Verified: `documents.spec.ts` 18/18 (3 runs), `reminders.spec.ts` 16/16 pass + 2 skipped
   (2 reseeded runs, REM-003 is env-gated, not a failure — TC-015's admin→worker scenario clean
   both times, no date-picker flake), all 4 session specs green across 3 full batches (30/30) + 5
   dedicated `session-active-org-isolation` reruns. Unit 140/140, lint 0 errors, format clean.**

**Known, unrelated pre-existing flakiness to distinguish from a real regression when touching these
specs:**
- `reminders.spec.ts` explicitly documents (in its own header) that TC-015/TC-018 mutate a shared
  seeded `CourseAssignment` row and the file is NOT safe to re-run twice without reseeding between
  runs — running it back-to-back without a reseed hung/timed out this session; that's expected
  fixture staleness, not a regression. Always `npx tsx prisma/seed.ts` against `lms_e2e` between
  repeated runs of this file.
- A "known pre-existing broken date-picker" (`pickFutureDate`, reminders.spec.ts ~line 66) was
  flagged by QA (P5-003/P6-007) as a possible source of flakiness distinct from the guard bug — did
  NOT reproduce in either of this round's clean runs, so treat any FUTURE reminders.spec.ts failure
  as needing this same triage: is it the guard (content hidden/evicted) or the date picker
  (`#date-picker-popover` never opens/hides)?

**Infra recipe** (reconfirmed working this round): prod build (`next build` + `next start -p 3005`)
against `lms_e2e`, with `DATABASE_URL`/`AUTH_URL`/`NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL`/`APP_URL`
all pinned to `:3005`, `MINIO_PORT=9005`, `E2E_TEST_BYPASS_RATE_LIMIT=true`, dummy
`GOOGLE_PROJECT_ID`/`SMTP_*`. Kill any stray `next-server` process on :3000/:3005 before rebuilding
— an old build can otherwise keep serving pre-fix code even after `npm run build` completes, since
`npm run start` must also be restarted. Migrations are managed separately from the working-tree
product-code change under test — `npx prisma migrate status`/`deploy` against `lms_e2e` as usual;
an uncommitted `src/` change doesn't affect migrations at all.

**Note on this memory file's own history:** an earlier, more detailed version of this file (with
per-round batch-run counts, false-eviction root-cause reasoning, and a note about a broken
`locator.isVisible({timeout})` test bug I found+fixed in `session-active-org-isolation.spec.ts`
during round-2 diagnosis) existed on a prior branch/session but was not present when this branch
(`bugfix/session-isolation`) was checked out — likely because it was never committed (agent memory
files are written directly to the working tree, not auto-committed, and this repo's branches don't
share an uncommitted working tree). If you find that richer version elsewhere, prefer merging it in
rather than treating this file as the sole record.
