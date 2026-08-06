---
name: project-tier3-perf-plan
description: Status of the Tier 3 (app-level) performance optimization plan from the platform-speed-optimization-plan-2026-07-22.md program
metadata:
  type: project
---

Tier 3 implementation plan drafted 2026-08-05, saved to `docs/perf/tier3-implementation-plan.md` (pending user review/approval, not yet handed to code-ninja as of this writing).

**Why:** Part of a larger 4-tier platform speed program (`platform-speed-optimization-plan-2026-07-22.md` + `platform-speed-measurement-runbook-2026-07-23.md`, both repo-root, local-only docs). Tiers 1/2 are Cloudflare/nginx/infra (not code). Tier 3 is app-level Next.js/Prisma code changes; Tier 4 is DB/host. User's steer: ship 5.2 (dynamic imports) first, then 5.1 (session resolution), then 5.3 items individually, 5.4 (worker separation) as its own infra track (scoping only, no extraction in this program), 5.5 as hygiene.

**How to apply:** All 5 Tier-3 findings from the 22 Jul source doc were re-verified against current code on 2026-08-05 (branch `feat/onboarding+video-list`) and **all still hold** — line numbers drifted but no fix has landed yet. Notable findings beyond the source doc: `getCourseForOrgView` (course.ts) shares `getCourseById`'s exact over-fetch bug — bundle into the same PR; `output: 'standalone'` (5.5) conflicts with the Dockerfile's reliance on full `node_modules` for the tsx-driven worker scripts — do not treat as a free hygiene win, it's gated behind Tier 4/5.4's worker-extraction; `ioredis` (`rateLimiterRedis` in `src/lib/rate-limit.ts`, same pattern as `src/lib/session-mfa.ts`) is the existing infra to reuse for 5.1's revalidation-cache TTL rather than adding new dependencies. The plan decomposes Tier 3 into 14 independently-shippable PRs (PR-1..PR-14) with per-PR risk, test scope, and the runbook's on-server-curl measurement gate. See [[reminders-manager-rbac-dependency]] and [[rbac-enforcement-gaps-and-hr-delete-decision]] for related RBAC context that PR-5 (session consolidation) touches.

Before reusing this memory in a future conversation, re-verify against `docs/perf/tier3-implementation-plan.md` directly (open questions may have been resolved, PRs may have shipped) rather than trusting this summary alone.
