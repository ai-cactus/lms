> **RESOLVED 2026-08-10 — the nginx open question in this document is answered: NO.**
> `cloudflared_config.yml` routes both hostnames straight to the app ports, so the
> tunnel does **not** proxy through nginx. The nginx compression / `_next/static`
> caching line items in §9 are therefore **not actionable** — there is no nginx in
> the request path to configure, and `lms2_nginx.conf` has been deleted. If those
> wins are still wanted, they belong at the app layer or at Cloudflare (which can
> compress and cache at the edge). See `docs/deployment.md` §2.3.

# Tier 3 — Application-Level Performance: Implementation Plan

**Status:** Draft — pending review · **Author:** architect (planning agent) · **Drafted:** 2026-08-05
**Source of truth:** `platform-speed-optimization-plan-2026-07-22.md` §5, `platform-speed-measurement-runbook-2026-07-23.md` §3 (Steps 6/8/9) + §4
**Scope:** Tier 3 only (application-level Next.js/Prisma work). Tiers 1/2/4 are out of scope here.
**Hand-off:** This document, once approved, is ready for `code-ninja` (implementation) and `bug-hunter` (test authoring/execution), PR by PR, in the sequence below.

---

## 1 · Objective

Reduce per-request application work (session resolution, over-fetching Prisma queries, heavy client bundles) so that warm SSR on `/login` and authenticated dashboard routes shrinks measurably **on the server** (`curl localhost:3000`, isolated from network/edge), without regressing auth security semantics, tenant isolation, or existing behavior. Success = each shipped PR has a runbook-defined measurement gate that passes, plus green unit + e2e coverage from `bug-hunter`.

## 2 · Context & Assumptions (confirmed by direct code read, 2026-08-05)

The source plan is dated 22 Jul 2026; the codebase has since merged onboarding step‑3 work and other PRs. I re-read every file the plan names and re-verified each of the five findings against current `HEAD` on `feat/onboarding+video-list`. **All five findings still hold** — none has been fixed since. Line numbers have drifted in most files; corrected references are below. I also found two related issues not explicitly named in the source doc, called out inline.

Versions confirmed from `package.json` (Documentation-First / Version Awareness):
- `next`: `16.2.11`
- `next-auth`: `^5.0.0-beta.30` — **still beta**. Any change to the `jwt`/`session` callback contract in `create-auth-instance.ts` must be verified against the beta docs/changelog for that exact version, not assumed stable-v5 behavior.
- `@prisma/client` / `prisma`: `^7.8.0`
- `ioredis`: `^5.10.1` — already used for rate limiting (`src/lib/rate-limit.ts`) and per-session MFA state (`src/lib/session-mfa.ts`), both via a shared exported client `rateLimiterRedis`. **This is the client to reuse for 5.1's revalidation cache** — no new infra dependency needed.

### 5.1 — Session resolution (CONFIRMED, holds everywhere named + 1 more site)

`src/lib/create-auth-instance.ts`:
- JWT strategy: `session: { strategy: 'jwt', ... }` now at **lines 710–713** (was :704).
- Per-decode DB re-validation (`prisma.user.findUnique` with profile join): now at **lines 599–614** (was :577–607).
- Token stamped with role/org: now at **lines 660–661** (was :562–564).
- The DB-error path is deliberately **fail-open** (comment "F-036, deliberate, do not change", lines 615–627): a DB failure returns the existing token rather than invalidating the session. **Any caching fix must preserve this fail-open contract** — a Redis outage must not force re-auth or mass-invalidate sessions either.
- Retired-role guard (`token.role === 'admin'` → force re-auth, lines 591–597) and `sessionVersion` mismatch → invalidate (lines 640–645) both currently run on **every** decode. A cache must not skip these checks on a cache-hit in a way that delays revocation beyond the agreed TTL.

`resolveSession()` (`Promise.all([adminAuth(), workerAuth()])`) confirmed present, unchanged in:
`course.ts:18–22`, `offering.ts:12–15`, `enrollment.ts:154–157`, `certificate.ts:15–18`, `notifications.ts:9–13`. Also `auth.ts:396` (`forceResetPassword`, not previously enumerated but same family — awaits both `adminAuth()`+`workerAuth()`).

Two files already carry a **partial mitigation** worth preserving/generalizing rather than reverting:
`user.ts:12–29` and `mfa.ts:29–44` try a single `referer`-based auth call first (`/worker` in referer → only `workerAuth()`; else only `adminAuth()`), falling back to `Promise.all(both)` only if that guess misses. `video-progress.ts:12–15` (`currentUserId()`) always calls both but only extracts `.id`.

Org/role re-fetch after `resolveSession()` confirmed at: `course.ts:32–35` (`getCourses`), `offering.ts:20–32` (`resolveOrg()` — re-fetches **and** re-asserts admin), `enrollment.ts:458–461` (`getCourseAssignmentSettings`) and `enrollment.ts:526–533` (`assignCourseToRole`, full `include: { organization: { include: { subscription }}}`). The session object already carries `session.user.role` and `session.user.organizationId` (set in the `session()` callback, `create-auth-instance.ts:690–692`) — these re-fetches are redundant once the JWT is trusted.

### 5.2 — Heavy libraries (CONFIRMED, byte-for-byte unchanged)

- `src/app/(auth)/components/AuthHeroSlider.tsx:5` — `import { motion, AnimatePresence, wrap } from 'framer-motion';`, still static in a `'use client'` component rendered on every auth page (confirmed: file unchanged since the finding).
- `src/lib/staff-csv.ts:14` — `import * as XLSX from 'xlsx';`, still static. Confirmed pulled into the client bundle transitively via `src/components/dashboard/staff/InviteStaffModal.tsx:18–23`, which statically imports `readStaffSpreadsheetRows` et al. from `staff-csv.ts` at module top.
- `src/lib/certificate-export.ts:9–10` — `import { toPng } from 'html-to-image'; import { jsPDF } from 'jspdf';`, still static.
- `src/lib/billing-prices.ts:118` is still the **only** `unstable_cache` usage in the codebase (confirmed) — the pattern to copy for 5.3's catalog caching: `unstable_cache(fn, [cacheKey], { revalidate: 3600, tags: [...] })`.

### 5.3 — Over-fetching query shapes (CONFIRMED; +1 addition found)

- `course.ts:108–166` `getCourseById` — confirmed: 3-way quiz-question nesting (module→lesson→quiz→questions, top-level quiz→questions, top-level lessons→quiz→questions) plus unfiltered `enrollments: { include: { user: { include: profile }, certificate }}` (no `where`, no `select`) plus unfiltered `creator: { include: profile }`.
  - **Addition not in the source doc:** `course.ts:178–221` `getCourseForOrgView` has the **identical** over-fetch shape (same triple quiz nesting), differing only in that its `enrollments` clause is already `where: { user: { organizationId }}` — so the tenant-scoping half of the 5.3 fix is already done here; only the `select`/`_count` shaping is missing. Same root cause, same file — bundle into the same PR.
- `enrollment.ts` sequential per-user loop confirmed at **two** sites (both call `src/lib/enrollment/create.ts`'s `createEnrollmentForUser`, which itself does up to ~7 sequential DB ops per entry: `user.findUnique`, optional `profile.upsert`, `enrollment.findFirst`, then either invite `findFirst`+`update`/`create`+`inviteCourseAssignment.upsert`, or `enrollment.create`+`reminderLog.create`+`createNotification`, plus 1–2 blocking `await sendXEmail(...)` network calls):
  - `enrollment.ts:412–436` — `enrollUsers` (was :358–381).
  - `enrollment.ts:636–643` — `assignCourseToRole` (was :562–586).
- `staff.ts:35–68` `getStaffDetails` — confirmed: `enrollments.include.course.include.lessons.include.quiz` (full quiz row, no select) + `quizAttempts` (no select → includes the `answers` JSON column) per enrollment.
- `course.ts:26–106` `getCourses` — confirmed: still pulls `enrollments: { select: { status: true }}` per course to count client-side, unlike `getDashboardData` (same file, **lines 364–498**, was :377–417) which already uses the `enrollment.groupBy` aggregation pattern (F-028) — copy that pattern.
- `enrollment.ts:178–186` `getAvailableUsers` — confirmed, **exact same line numbers as the original doc**: `prisma.user.findMany({ where, include: { profile: true }})` with no `select` → full `User` rows (password hash, MFA secret columns, etc.) held in server memory for a 5-field DTO. Security-hygiene point per Core Rule #5, trivial fix, near-zero risk.
- `offering.ts:53–99` `listAvailableVideoCourses` — confirmed as the global-catalog candidate for `unstable_cache`. **Important nuance:** the catalog is only *mostly* org-independent — the query does `offerings: { where: { organizationId }}` inline, so the whole result as written is per-org. The cacheable part is the published-global-course + lesson/quiz-count shape; the per-org "is this offered" flag must be joined **after** the cache read, not baked into the cached payload, or the cache key/tag design balloons to one entry per org (defeating the purpose and risking a slow first-hit per org). This needs to be split into (a) a cached `getGlobalVideoCatalog()` and (b) a small per-org offerings lookup merged client-side of the cache boundary.

### 5.4 — Background workers on the web VM (CONFIRMED)

`src/instrumentation.ts:23–75` (was :40–62, drifted because of added correlation-ID/env-validation code above it) boots `manual-indexer`, `video-transcode` (ffmpeg child processes), `video-sweep`, `reminder-sweep`, and `notification-digest` BullMQ workers inside the web process's `register()` hook. The code's own comment (lines 37–39) already states the fix is a dedicated worker service, tracked in `docs/rebuild/`.

`ecosystem.config.js` confirms: production pm2 `exec_mode: "cluster"`, `instances: 2` on a comment-documented 2-vCPU VM (staging runs 1 instance). Each of the 2 production instances independently calls `register()`, so the 5 background workers boot **twice** — confirmed, matches the finding exactly.

### 5.5 — Small wins (CONFIRMED, with one architecture conflict found)

- `src/proxy.ts:91–92` — two unconditional `logger.info` calls fire on every matched (protected-route) navigation, exactly as described. **Additional finding:** `proxy.ts:107–110` logs a third `logger.info` (with `maskEmail`) on every successful token decode — same noise class, same file, worth including in the same fix since it's the identical pattern one function down.
- `next.config.ts` confirmed: no `output: 'standalone'` set.
- **Architecture conflict found (not in source doc):** `Dockerfile:74–80` explicitly copies the **full** `node_modules`, `generated/`, `db/`, and `tsconfig.json` into the runtime image with the comment "the queue workers run `scripts/{transcode,index}-worker.ts` via `node --import tsx` at runtime" — i.e., the current image relies on the complete `node_modules` (including `tsx` and every worker dependency) being present at runtime for something outside the standard Next.js server. Switching to `output: 'standalone'` (which prunes `node_modules` to only what the Next.js server itself needs) **will break those tsx-driven worker scripts** unless they're re-provisioned separately. This interacts directly with 5.4 (worker extraction) — see Risks §7 and the PR-12 scoping note below.
- `lms2_nginx.conf` (repo root) confirmed: no `gzip`/`brotli` directive, no `/_next/static` location block. **Open question:** the runbook's own methodology note says Tier 1/2 changes must NOT move on-server `curl localhost:3000` numbers — nginx compression is a Tier‑1/2-flavored, infra-deployed change (this file is a checked-in copy of `/etc/nginx/sites-available/lms` on the VM; the Next.js app itself never loads it). Whether the production tunnel actually routes through this nginx (vs. bypassing it) needs an infra-side confirmation before this line item is prioritized — see Open Questions §9.

---

## 3 · Constraints & Dependencies

- **"One logical change per PR"** (repo convention) — Tier 3 is decomposed into 12 independently-shippable PRs below, not one big diff.
- **Runbook methodology rule (hard constraint):** every Tier 3 PR's measurement gate is Runbook §3 Step 8 — on-server `curl -so /dev/null -w 'ttfb:%{time_starttransfer}\n' http://localhost:3000/login` (×5, median) before/after, run **on the VM**, isolated from network/edge. A PR that doesn't move this number (or moves the *wrong* gauge, e.g. only the edge-facing `perf-snapshot.sh`) fails its own acceptance check per the runbook's §4 sanity cross-check.
- **NextAuth v5 beta**: the `jwt`/`session` callback shape and invocation frequency are beta-stage APIup — code-ninja should re-confirm the exact NextAuth 5.0.0-beta.30 changelog/behavior for the `jwt` callback before modifying `create-auth-instance.ts`, per Documentation-First.
- **Fail-open DB semantics (F-036)** in the JWT callback must not be weakened by caching — a Redis outage must degrade to the *existing* DB-query fail-open path, not to a fail-closed or stale-forever state.
- **Multi-tenant isolation** — every 5.3 query reshape must preserve existing `organizationId` scoping (several call sites already have explicit "never leak another tenant's X" comments); reshaping must not accidentally drop a `where` clause during the `select`/`include` rewrite.
- **RBAC** — session-derived role checks (5.1) must continue to gate identically to today's DB-read role checks; a role change must still take effect within the same revocation window the app already promises today (see §6 tradeoff).
- Existing structured logging / no-`console.*` / Tailwind+shadcn rules apply to any touched UI (5.2's `AuthHeroSlider` fix does not change markup, only import strategy, so no shadcn/Tailwind surface here).

## 4 · Approach Evaluation

**5.1 caching mechanism — Redis TTL cache vs. in-memory per-instance cache vs. no cache (status quo):**
- In-memory (`Map` per pm2 instance): zero new infra, but with `pm2 cluster` × 2 instances (soon possibly more), cache state isn't shared — a revoked user could still pass on the instance that hasn't seen the revocation-triggering write, AND doesn't reduce load on a per-fleet basis (still 1 DB query per instance per TTL window). Also loses all warmth on every deploy/restart.
- **Redis TTL cache (recommended)**: reuses the existing `rateLimiterRedis` client and the exact key/TTL pattern already proven in `session-mfa.ts` (`SET key value EX ttl`). Shared across both pm2 instances and both NextAuth instances (admin/worker), survives individual process restarts, and the existing rate-limiter's fail-open/fail-closed vocabulary is already established in this codebase (`checkRateLimit(..., { failClosed })`) — consistent idiom to extend. Cost: one more Redis round-trip on a cache miss (already a dependency the auth path has for MFA), negligible vs. a Postgres round-trip saved on every hit.
- No cache: rejected — doesn't address the finding at all.

**5.1 session-resolution collapse — generalize the referer-based single-call pattern vs. leave `Promise.all(both)` everywhere:**
- Recommend generalizing `user.ts`/`mfa.ts`'s referer-based pattern into one shared helper (e.g. `src/lib/auth/resolve-session.ts`) used by all 9+ action files, rather than duplicating the `Promise.all` pattern or hand-rolling referer logic per file. This is strictly additive/consolidating — no behavior change to *which* session wins, only *how many auth() calls* it costs to find out. Once 5.1's Redis cache (above) lands, even the referer-guess-wrong fallback path costs at most one cache-hit Postgres query, so this is safe to layer on top rather than being a prerequisite.

**5.3 `getCourseById` reshape — narrow `select` vs. leave `include` but add `where`:**
- Recommend explicit `select` (not just narrower `include`) per Core Rule #6 (avoid over-fetching) and to match the existing `getDashboardData`/`getCourseForOrgView` precedent in the same file, which already uses scoped `where` on `enrollments`. `select` also makes the DTO shape self-documenting and prevents an accidental future `include` from silently reintroducing the bloat.

**5.3 catalog caching — single cached global fetch + per-request per-org join vs. one cache entry per org:**
- Recommend split as described in §2. Per-org cache entries would multiply the cache's storage/invalidation surface by tenant count for no benefit (the offerings join is already a cheap, indexed `groupBy`/`findMany` scoped by `organizationId`).

**5.4 — assess/scope only, no extraction in this program (per your steer).** Options for the eventual extraction (documented for the future ADR, not built now): (a) separate BullMQ worker process/container reusing the same codebase's queue definitions (`src/lib/queue/*`), started via its own `node --import tsx` or compiled entrypoint, sharing Redis + Postgres with the web tier; (b) managed queue service (e.g., Cloud Tasks/Cloud Run Jobs) — bigger infra lift, likely overkill at current scale; recommend (a). This is a "own infra track" deliverable, not a code-ninja PR.

## 5 · Proposed Architecture & Workflow (5.1 detail, the only item needing new shared infrastructure)

```
Request → NextAuth jwt() callback (create-auth-instance.ts)
  → token.id present?
    → cache lookup: rateLimiterRedis.get(`session-revalidate:${token.id}`)
        HIT  → parse cached {role, organizationId, mfaEnabled, sessionVersion, authProvider, profileFullName, mfaVerifiedAt}
               → still re-run the in-memory checks that don't need a fresh read
                 IF they're already satisfied by the cached snapshot (retired-role guard,
                 sessionVersion mismatch against token) — no new DB call.
        MISS → existing prisma.user.findUnique(...) (unchanged query/shape/fail-open behavior)
               → on success: rateLimiterRedis.set(key, JSON.stringify(snapshot), 'EX', TTL)
               → on DB error: existing fail-open return token (unchanged) — cache NOT written
  → existing sessionVersion / retired-role / org-null / mfaVerified logic runs unchanged,
    just fed from either the cache or a fresh DB read.
```

- **TTL: 30s default**, configurable via `SESSION_REVALIDATION_TTL_SECONDS` env var (documented, per Core Rule #16). 30–60s window explicitly trades **revocation latency for DB load**: a role change, `sessionVersion` bump (password reset, staff removal), or org-removal now takes up to TTL seconds longer to take effect on an already-decoded session, instead of the next single request. **This must be called out to the user/stakeholders as a deliberate security tradeoff, not a silent side effect** (see §6).
- Cache key includes `userId` only (not `sessionId`) — the cached snapshot is genuinely per-user (role/org/mfaEnabled/sessionVersion), not per-session; per-session MFA-verified state continues to be read from the existing separate `session-mfa:` Redis key (unchanged, still per-decode via `isSessionMfaVerified`).
- Cache invalidation on write: rather than proactively deleting the cache key on every role/org/session-version mutation (many call sites, error-prone to keep in sync), rely on the TTL expiry as the sole invalidation mechanism — this matches "purpose is revocation, not freshness" and keeps the change mechanical/low-risk. If the team later wants tighter revocation, `rateLimiterRedis.del(`session-revalidate:${userId}`)` can be added at the existing `sessionVersion: { increment: 1 }` call sites (staff.ts:214, staff.ts:621, auth.ts:426) as a fast-follow — flagged as optional, not in this PR's scope.

## 6 · Explicit Tradeoff Declaration — 5.1 Revocation TTL (mandatory callout)

**What changes:** Today, every JWT decode re-reads the user row from Postgres, so a role change, password-reset-triggered `sessionVersion` bump, org removal, or MFA toggle is reflected on the **very next request**. After this change, a cache hit within the TTL window serves the previously-read snapshot, so the same events take up to **TTL seconds** (default 30s) longer to propagate to an already-issued session.

**Why this is acceptable:** the JWT itself is already the source of truth for the session between decodes (NextAuth JWT strategy); the DB re-validation's entire purpose (per the existing code comments) is *revocation* — catching a role change, a forced logout, or an org removal — not *freshness* of unrelated profile data. A 30–60s window is well inside normal human perception of "my access was just revoked" and is the same order of magnitude as typical CDN/edge cache windows already accepted elsewhere in this program (Tier 1's 10-minute public-page cache).

**Who should sign off:** this is a security-relevant behavior change (delayed revocation) and should be explicitly approved by you (and/or whoever owns the security posture for RBAC) before merge — I'm flagging it here rather than deciding it unilaterally. If the answer is "revocation must be instant," the TTL should be set to 0 (no functional change) or the fast-follow active-invalidation approach (§5, last bullet) should be pulled into scope 1.

## 7 · Task Breakdown — Phased PR Plan

Sequenced per your steer: **5.2 → 5.1 → 5.3 (individually) → 5.4 (scoping only) → 5.5 (hygiene)**, ordered within each tier by impact vs. risk. Every PR includes its runbook measurement gate. PRs within a tier have no cross-dependencies unless noted, so `bug-hunter` can validate PR *n* while `code-ninja` starts PR *n+1* once *n* is merged; PRs across tiers are sequential per the plan (5.1's PRs assume 5.2 is unrelated/parallel-safe — no shared files).

### Tier A — 5.2 Dynamic imports (low risk, ~½ day total, ship first)

**PR-1: Dynamic-import `framer-motion` in `AuthHeroSlider`**
- Files: `src/app/(auth)/components/AuthHeroSlider.tsx`.
- Change: wrap the component (or just the `motion`/`AnimatePresence` usage) behind `next/dynamic(..., { ssr: false })`, matching the existing quill/react-pdf/recharts pattern in this codebase. Provide a lightweight non-animated `<Image>`-only fallback/skeleton for the dynamic-import loading state so `/login`'s LCP element (the slider image) isn't blocked waiting for the framer-motion chunk.
- Risk: low. Purely a loading-strategy change; no markup/behavior change once hydrated. Regression surface: slide auto-advance/drag interactions, initial paint flash.
- Tests (`bug-hunter`): unit — component still renders slides and cycles on the fake timer; e2e — `/login` visual smoke (existing auth e2e spec, extend or add `tests/e2e/auth-login.spec.ts` assertion that the slider becomes interactive) + confirm no console errors from a dynamic import failure.
- Measurement gate: Runbook §3 Step 6 — `npm run build` route-size diff for `/login`'s First Load JS before/after (expect a ~30–40kB drop), then post-deploy Lighthouse on `/login` vs. baseline (79/100, LCP 4.5s, 345kB JS).

**PR-2: Dynamic-import `xlsx` in `staff-csv.ts`**
- Files: `src/lib/staff-csv.ts` (move `import * as XLSX from 'xlsx'` to a dynamic `await import('xlsx')` inside `readStaffSpreadsheetRows` / wherever XLSX is actually invoked), and update its caller(s) (`InviteStaffModal.tsx` and any onboarding step 4/5 usage) only if the function signature needs to become async-earlier (it likely already is, given file parsing is async).
- Risk: low-medium — must confirm every caller already awaits the parsing function; a missed `await` would silently break parsing rather than error loudly, so add an explicit runtime check.
- Tests: unit — `staff-csv` parsing tests (pure `extractStaffEmailsFromRows` logic is unaffected; add a test that the XLSX-dependent read path still parses a fixture spreadsheet); e2e — staff bulk-invite flow via CSV upload still completes.
- Measurement gate: Step 6 route-size diff for the dashboard/staff route family (not `/login` — xlsx isn't in the login bundle) + confirm `xlsx` no longer appears in the shared/`_app` chunk via the build output.

**PR-3: Dynamic-import `jspdf` + `html-to-image` in `certificate-export.ts`**
- Files: `src/lib/certificate-export.ts`.
- Change: dynamic `import()` both libs inside the export function, at click time, mirroring PR-2's pattern.
- Risk: low. Same shape as PR-2.
- Tests: unit — export function still produces a PDF blob from a fixture DOM node (mock the dynamic imports in the unit test per existing project conventions for external deps); e2e — certificate download flow from the worker portal still succeeds.
- Measurement gate: Step 6 build-size diff for the certificate-modal-owning route.

### Tier B — 5.1 Session resolution (sequenced after 5.2; PR-4 must land before PR-5)

**PR-4: Short-TTL Redis cache for JWT decode-time DB revalidation**
- Files: `src/lib/create-auth-instance.ts` only (+ new small helper, e.g. `src/lib/auth/session-revalidation-cache.ts`, following the `session-mfa.ts` shape).
- Change: as described in §5. Reuse `rateLimiterRedis` from `src/lib/rate-limit.ts`. New env var `SESSION_REVALIDATION_TTL_SECONDS` (default `30`), documented in `.env.example`/README per Core Rule #16. Preserve the existing fail-open-on-DB-error path unchanged; cache is best-effort (a Redis error should fail open to the existing DB read, not throw).
- Risk: **highest in this program** — touches the core auth decode path used by every authenticated request on both NextAuth instances. Regression surface: role changes, password-reset session invalidation (`sessionVersion`), forced logout / staff removal, MFA enable/disable, retired-role force-reauth, org-removal denial — every one of these has an existing "F-0xx" guard comment; each must be re-verified to still fire (within the new TTL window) after this change.
- Tests (`bug-hunter`, must be thorough given the risk):
  - Unit: cache hit skips the DB call (spy/mock `prisma.user.findUnique`); cache miss populates the cache; Redis error falls back to the existing DB path unchanged; TTL expiry triggers a fresh DB read; a `sessionVersion` bump is honored once the cache TTL elapses (simulate via short TTL in test config) and is *not* honored before TTL elapses (documents the tradeoff, doesn't hide it); retired-`admin`-role force-reauth still fires on a cache miss.
  - e2e: login → role changed by an admin in another session → original session still has old role until TTL passes, then loses access / gets redirected — this is the regression test that proves the tradeoff is bounded, not open-ended. Also: password reset still force-logs-out other sessions within the TTL window. Also: staff-removal (org-null) denial still triggers.
- Measurement gate: **Runbook §3 Step 8** — on-server `curl localhost:3000/login` ×5 median before/after, PLUS `pg_stat_statements` top-10 `calls`/`mean_ms` for the `User` findUnique-by-id shape should drop materially after 24h of traffic (requires Tier 4's `pg_stat_statements` to already be enabled — flag as a soft dependency, not a blocker, since the on-server curl alone is sufficient to gate the PR).

**PR-5: Consolidate `resolveSession()` + stop re-fetching org/role from the DB**
- Files: `course.ts`, `offering.ts`, `enrollment.ts`, `user.ts`, `mfa.ts`, `certificate.ts`, `video-progress.ts`, `notifications.ts`, `auth.ts` (`forceResetPassword`); plus a new shared helper (e.g. `src/lib/auth/resolve-session.ts`) generalizing the `user.ts`/`mfa.ts` referer-based single-call pattern, replacing each file's local `resolveSession()`/`currentUserId()` duplicate.
- Change, per call site:
  1. Replace the local `resolveSession()`/`currentUserId()` copy with the shared helper (referer-based single-call-first, `Promise.all` fallback only when the guess misses — behaviorally identical resolution outcome, fewer calls).
  2. Everywhere a function re-fetches `organizationId`/`role` via `prisma.user.findUnique` immediately after `resolveSession()` succeeds, read `session.user.organizationId` / `session.user.role` instead — both are already populated by the `session()` callback (`create-auth-instance.ts:690–692`) and are now backed by PR-4's cache, so this doesn't reintroduce a full-cost DB hit even indirectly.
  3. `offering.ts`'s `resolveOrg()` also re-asserts `isAdminRole(user.role)` — preserve that assertion using `session.user.role` instead of the re-fetched `user.role` (identical check, cheaper source).
- Risk: medium — wide file touch, but mechanical; the main hazard is accidentally trusting a stale/wrong role in one of the ~15 call sites during the mechanical rewrite. Mitigate by doing the rewrite function-by-function with a 1:1 diff review, not a global find/replace.
- Tests: unit — each rewritten function still throws `Unauthorized`/`Forbidden` under the same conditions as before (no session, wrong role, org mismatch); e2e — re-run the existing course/offering/enrollment/staff/mfa/certificate e2e specs unchanged (this PR must not change observable behavior, only the DB call count) — `bug-hunter` should treat any existing e2e failure here as a real regression, not flaky.
- Measurement gate: Runbook §3 Step 8 — on-server curl before/after on an **authenticated** route this time (use the `SESSION_COOKIE` env override mentioned in Runbook §1, hitting e.g. `/dashboard` or a course page) since `/login` itself isn't authenticated and won't show this PR's effect; report the `calls` drop for the redundant org/role `findUnique` query shape in `pg_stat_statements`.

### Tier C — 5.3 Over-fetching (each its own PR, sequenced worst-impact-first per the source doc)

**PR-6: `getCourseById` + `getCourseForOrgView` reshape (`course.ts`)**
- Change: explicit `select` for modules/lessons/quiz/questions; `enrollments` scoped to `where: { userId: session.user.id }` (getCourseById) — already scoped by org in `getCourseForOrgView`, just needs the `select`/`_count` narrowing; use `_count` for aggregate enrollment/user counts where the full row isn't needed by the caller. Confirm the calling components (course detail pages) only consume the fields kept.
- Risk: medium — the returned `CourseWithRelations` type is consumed by course-detail UI; must audit every field the UI reads before narrowing (a silently-dropped field breaks a UI section rather than erroring).
- Tests: unit — shape/field-presence tests on the returned DTO; e2e — course detail page (both the creator/enrolled path and the org-view browse path) still renders lessons, quiz counts, and enrollment/certificate status correctly.
- Measurement gate: Step 8 on-server curl on a course-detail route + `pg_stat_statements` before/after for this query shape (row/byte count reduction is the qualitative signal; `mean_ms` is the quantitative one).

**PR-7: Batch the per-user enrollment loop (`enrollUsers`, `assignCourseToRole`)**
- Files: `enrollment.ts:412–436`, `enrollment.ts:636–643`, `src/lib/enrollment/create.ts`.
- Change: pre-fetch existing users via `{ email: { in: [...] }}` / `{ organizationId, role: targetRole }` (already done for the holder list) in one query up front; pre-fetch existing enrollments and existing pending invites for the batch in one query each (mirrors the seat-check block at `enrollment.ts:365–379`, which already does exactly this pattern for a different purpose — reuse it); use `createMany` for the straightforward new-enrollment case; chunk the remaining per-user side-effects (profile upsert, invite create/update, reminder log, in-app notification, transactional email) into a bounded `Promise.all` (e.g. batches of 10–20) rather than a fully sequential `for...of await`. Email sends in particular should stay resilient to individual failures (already true today — preserve the existing try/catch-and-log-only behavior per entry).
- Risk: **highest of the 5.3 items** — this is core enrollment/billing/notification business logic with seat-limit accounting, invite dedup, and email side effects; changing its concurrency model risks a race on the seat-limit check (`seatRejectedEmails`) or a partial-failure ordering change that the current sequential loop implicitly avoids. Recommend implementing with explicit chunked concurrency (not full parallelism) and preserving the exact per-entry outcome semantics（`failed`/`alreadyEnrolled`/`invited`/`enrolled`) so `results` accumulation is unaffected.
- Tests: unit — `createEnrollmentForUser`/batch-helper covers: mixed batch of new/existing/duplicate/seat-rejected entries produces identical `results` counts to today; a mid-batch email failure doesn't abort the batch; concurrent duplicate emails in one batch don't double-enroll. e2e — CSV bulk-invite flow (large batch, e.g. 50+ rows) end-to-end, and the "assign to role" flow with multiple current role-holders.
- Measurement gate: Step 8 — this is best measured by wall-clock time of the action itself (not `curl /login`), reported alongside the on-server curl sanity check; also report the DB `calls` reduction in `pg_stat_statements` for the `User`/`Invite`/`Enrollment` findUnique/findFirst shapes this loop drove.

**PR-8: `getStaffDetails` select narrowing (`staff.ts`)**
- Change: `select` (not `include`) on `course.lessons.quiz` → only `passingScore`, `allowedAttempts`; `select` on `quizAttempts` → only `score`/`completedAt` (drop the `answers` JSON column from this read path).
- Risk: low — single read-only function, narrow consumer surface (staff detail page).
- Tests: unit — DTO shape test; e2e — staff detail page still shows correct course/quiz stats.
- Measurement gate: Step 8 on-server curl on the staff-detail route + row-byte reduction note.

**PR-9: `getCourses` → `groupBy` aggregation (`course.ts`)**
- Change: copy the `enrollment.groupBy({ by: ['courseId','status'], _count })` pattern already used in `getDashboardData` (same file, lines 364–498) instead of pulling every enrollment row per course to count client-side.
- Risk: low-medium — must preserve the exact `completionRate` calculation semantics (completed+attested / total) when switching from array-filter to grouped counts.
- Tests: unit — completion-rate math matches the old implementation on a fixture set (regression test comparing old vs. new calculation is ideal here, even temporarily, to prove parity); e2e — courses list/dashboard still shows correct counts.
- Measurement gate: Step 8 on-server curl on `/dashboard/training` (or wherever `getCourses` backs).

**PR-10: `getAvailableUsers` explicit `select` (`enrollment.ts`) — security hygiene, ship independently/early if desired**
- Change: replace `include: { profile: true }` with `select: { id, email, role, profile: { select: { fullName, avatarUrl }}}` — matches exactly what the mapped return object uses.
- Risk: very low.
- Tests: unit — DTO shape unchanged from the caller's perspective; e2e — share-modal user picker still lists users correctly.
- Measurement gate: Step 8 on-server curl (marginal expected effect, but qualitative win is removing password-hash/MFA-secret columns from server memory — call this out explicitly as a security fix, not just perf, in the PR description).

**PR-11: `unstable_cache` the global video-course catalog (`offering.ts`)**
- Change: split `listAvailableVideoCourses` into (a) a new `getGlobalVideoCatalog()` wrapped in `unstable_cache(..., ['global-video-catalog'], { revalidate: 3600, tags: ['video-catalog'] })` returning the published-global-course + lesson/quiz-count shape (no `organizationId` in the query), and (b) the existing per-org `offerings.where({organizationId})` lookup, merged in-memory after the cached read. Call `revalidateTag('video-catalog')` at every course-publish/unpublish/status-change site (need to enumerate: course creation-publish flow, any admin "deactivate course" action) so the cache doesn't serve a stale catalog past a deliberate publish action.
- Risk: medium — must find and tag every mutation site that changes global-course `status`/`isGlobal`/`type`, or the cache can serve a stale published-course list for up to the revalidate window; a missed tag site is a silent staleness bug, not a crash, so needs careful enumeration + a regression test.
- Tests: unit — cache hit/miss behavior; `revalidateTag` invalidates on publish; e2e — admin publishes a new global video course → it appears in another org's "available courses" browse view without waiting for the 1h TTL.
- Measurement gate: Step 8 on-server curl on the available-courses browse route, before/after, cold vs. warm cache.

### Tier D — 5.4 Background worker separation (scoping only, no PR in this program)

**Deliverable D-1 (not code-ninja):** a short ADR/scoping doc under `docs/rebuild/` (append to or create alongside whatever already lives there) capturing: current state (confirmed above), the recommended direction (separate worker process reusing `src/lib/queue/*`, sharing Redis+Postgres), the Dockerfile/entrypoint implications (this worker process is exactly what currently needs the "full `node_modules` + tsx" runtime shape that blocks 5.5's `output:'standalone'` — see PR-12 note below), and a rough sizing/effort estimate (source doc: ~1–2 days) plus a recommended trigger (correlate "everything is slow" user reports with `docker stats` / queue activity, per the source doc's own guidance, before prioritizing the extraction). I can draft this ADR on request; it is out of scope for `code-ninja`/`bug-hunter` in this program per your steer.

### Tier E — 5.5 Hygiene (ship after everything above, or opportunistically earlier — genuinely independent)

**PR-12: `proxy.ts` log-level fix**
- Files: `src/proxy.ts:91–92` (target-auth + cookie-search logs) and `:107–110` (decoded-token log) — all three unconditional per-navigation `logger.info` calls → `logger.debug`.
- Risk: near-zero. Confirm nothing downstream depends on these specific lines appearing at `info` level (e.g., a log-based alert) before downgrading — quick grep-equivalent check by `code-ninja` at implementation time.
- Tests: unit — proxy still functions identically; no behavior test needed for the log level itself, but keep the existing proxy test suite green.
- Measurement gate: qualitative (log volume reduction), not a `curl` timing gate — note in the PR description rather than blocking on Step 8.

**PR-13: `output: 'standalone'` + Dockerfile — SCOPE-GATED, do not implement blind**
- This is **not** a drop-in `next.config.ts` flag flip here, because of the Dockerfile conflict found in §2: the runtime image currently depends on the full `node_modules` (plus `tsx`, `generated/`, `db/`, `tsconfig.json`) for the `scripts/{transcode,index}-worker.ts` processes that `Dockerfile:74–80` documents. `output:'standalone'` prunes `node_modules` to only the Next.js server's traced dependencies and would break those scripts unless they're re-provisioned.
- Recommendation: **defer this PR** until either (a) Tier D's worker extraction lands (the tsx scripts move to their own image/process with their own dependency set, freeing the web image to go standalone), or (b) `code-ninja` explicitly re-adds the worker scripts' dependency closure to the standalone output (`next build` with `output: 'standalone'` does support copying extra files via the `outputFileTracingIncludes` config, which could keep `tsx`+scripts working — but this needs to be verified against Next.js 16's current `outputFileTracingIncludes` docs before relying on it, per Documentation-First). Flag this as its own small scoping task, sequenced after Tier D's ADR, not bundled into the "hygiene" PR the source doc implies it is.
- If you want this shipped in this program regardless, say so and I'll fold option (b) into a concrete PR spec with the Next.js 16 doc citation.

**PR-14: nginx compression — CONFIRM APPLICABILITY FIRST**
- `lms2_nginx.conf` is a repo-checked copy of the VM's `/etc/nginx/sites-available/lms`; the Next.js app never loads it, so editing it doesn't affect `curl localhost:3000` (Tier 3's own gate) — it's an edge/tunnel-adjacent, infra-deployed change, more naturally a Tier 1/2 follow-up than "Tier 3 app code." Per your prompt's own caveat ("our tunnel bypasses nginx — confirm whether this still applies"), this needs an infra-side answer (does `cloudflared` actually proxy through this nginx, or straight to `:3000`?) before scoping a PR. If it does apply: add `gzip on;`/brotli directives for text MIME types + a `/_next/static` location block with long `Cache-Control`, redeploy the conf to the VM (out-of-band from the app deploy pipeline), and measure via the **edge-facing** `perf-snapshot.sh` (not the on-server curl, since this is explicitly an edge/tunnel-tier change mis-filed under Tier 3 in the source doc) — see Open Questions §9.

---

## 8 · Risks & Mitigations (program-level, beyond what's inline per-PR above)

| Risk | Mitigation |
|---|---|
| PR-4's cache subtly weakens revocation and nobody notices until an incident | Explicit tradeoff sign-off (§6) before merge; e2e regression tests that assert the TTL bound, not just "it still works"; `SESSION_REVALIDATION_TTL_SECONDS` env var makes the window auditable/tunable without a code change. |
| PR-5's mechanical rewrite silently trusts a stale role/org in one of ~15 call sites | Function-by-function review (not global find/replace); full existing e2e suite must stay green — treat any failure as a real regression given this PR's job is to be a no-op behaviorally. |
| PR-7's concurrency change introduces a seat-limit or duplicate-enrollment race under load | Chunked (not unbounded) concurrency; unit tests specifically targeting the seat-limit boundary and duplicate-email-in-batch cases; consider a feature-flag-free but PR-isolated rollout so it can be reverted independently of the other 5.3 PRs. |
| PR-11's cache tagging misses a mutation site → stale catalog | Explicit enumeration of every `status`/`isGlobal` mutation site as a checklist item in the PR description; e2e test asserting immediate visibility post-publish. |
| PR-13 shipped without the Dockerfile conflict resolved | Scope-gated explicitly above; do not let `code-ninja` treat this as a "free" hygiene win. |
| Runbook Step 8 gate run from the wrong vantage (edge instead of on-server) mis-attributes a network fluctuation to an app change | Every PR description must include the literal on-server `curl` command + before/after numbers, per Runbook §4's own sanity cross-check. |
| NextAuth v5 beta version drifts/changes callback semantics mid-implementation | `code-ninja` re-checks the installed `next-auth` version against its changelog before touching `create-auth-instance.ts` (PR-4/PR-5), not just at plan time. |

## 9 · Open Questions — RESOLVED (2026-08-05)

1. **5.1 TTL value** — ✅ **30s default, env-tunable** (`AUTH_REVALIDATE_TTL_SECONDS` or equivalent) so ops can adjust without a deploy. Active-invalidation fast-follow stays deferred, not pulled into PR-4.
2. **PR-7 rollout** — ✅ **Ship behind an explicit kill-switch env var**, old sequential path retained as instant fallback; flip on after production validation. (Chosen given prior enrollment/cascade history.)
3. **PR-13 (`output: 'standalone'`)** — ✅ **Deferred** until after Tier D's worker-extraction ADR. Parked.
4. **PR-14 (nginx)** — ✅ **Descoped.** Confirmed the production tunnel `config.yml` routes ingress straight to `localhost:3000`/`3001`, **bypassing nginx entirely** — nginx is not in the user-facing request path, so gzip/brotli/static-offload there yields no user benefit. Dropped from this program.
5. **Tier D ADR** — ✅ **Hold** until Tiers A–C land.

**Approved for hand-off to `code-ninja`.** Sequence starts with **5.2 (dynamic imports)** as the first PR.

---

*Tier 3 Implementation Plan · drafted 2026-08-05 · open questions resolved 2026-08-05 · APPROVED for implementation.*
