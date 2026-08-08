# Platform Speed Optimization — Results Report

**Program:** Theraptly LMS platform speed optimization (Tiers 1–4 + Argo)
**Reporting date:** 2026-08-08
**Status:** Build complete & verified; production rollout + time-gated decisions outstanding
**Companion docs:** `platform-speed-optimization-plan-2026-07-22.md` (plan), `docs/perf/tier3-implementation-plan.md` (Tier 3 detail), `platform-speed-measurement-runbook-2026-07-23.md` (methodology)

---

## 1 · Executive summary

The platform speed program is **implemented, tested, and merged**, and the application-level work (Tier 3) is **deployed to staging and measured**. Every trustworthy, network-independent signal moved the right way and nothing regressed:

- **On-server `/login` TTFB: ~15 ms → ~8 ms** (~45% faster; the cleanest signal — no network in the path).
- **`/login` First Load JS: 349.9 kB → 312.0 kB gzip (−10.8%)** — heavy libraries removed from the first-load payload.
- **Lighthouse `/login`: 0 KiB unused JS, 210 ms total blocking time** — a lean, well-split bundle.
- **Edge warm TTFB (staging, public routes): 1.23 s → 0.62 s median (−49%)** — strongly positive but network-confounded (see §4); treat as directional, not a headline figure.
- **Full automated test suite: 2,310 tests passing** across the changes, including adversarial coverage of the auth-cache revocation path and enrollment-batching equivalence.

**What "fully done" means here:** the build is done. What remains is **operational**, not engineering: promoting Tier 3 to production, a time-gated keep/cancel decision on the Argo trial, and one intentionally-deferred infrastructure track (worker split, 5.4).

---

## 2 · Program scope & status

| Tier | Item | What it does | Status |
|---|---|---|---|
| **1** | Edge caching (public pages) | Serve `/login`, marketing, etc. from Cloudflare's edge | ✅ Live (prod) |
| **2** | Tunnel & origin | cloudflared updated (2026.7.3), QUIC confirmed, **2 replicas**, origin keep-alives | ✅ Live (prod); cold-path penalty eliminated |
| **3** | App-level (Next.js + Prisma) | Auth-query cache, session reads, query-shape fixes, dynamic imports, log hygiene | ✅ Merged; **deployed to staging** |
| **4.3** | Argo Smart Routing | Fastest edge→origin path for dynamic traffic | 🔵 Enabled on **prod**; trial decision pending (day 3–7) |
| **4.4** | Origin placement | Move origin closer to US users | ⏸️ Decision framework only — trigger-gated, no action |
| **4 (DB)** | `pg_stat_statements` | Query-level profiling of the Tier 3 wins | ⬜ Optional / recommended for hard query metrics |
| **5.4** | Dedicated worker service | Move background workers off the web VM | ⏸️ **Deferred by design** (own infra track) |

### Tier 3 breakdown (the app-level work)

| Item | Change | Status |
|---|---|---|
| 5.1 | JWT revalidation cache (Redis, 30 s TTL, env-tunable) **+ active invalidation** on every `sessionVersion` bump; org/role read from session instead of re-queried | ✅ |
| 5.2 | Dynamic-import framer-motion / xlsx / jspdf off hot paths | ✅ |
| 5.3 | Six over-fetch query-shape fixes (`getCourseById`, `getStaffDetails`, `getCourses`, `getAvailableUsers`, catalog cache) + enrollment batching behind a default-off kill-switch | ✅ |
| 5.5 | Per-navigation proxy trace logs → `debug` | ✅ |
| — | nginx compression | Descoped (tunnel bypasses nginx) |

---

## 3 · Measured results

| Instrument | Metric | Before | After | Δ | Confidence |
|---|---|---|---|---|---|
| **On-server** `curl localhost:3001/login` | warm TTFB | ~15.2 ms | ~8.0 ms | −45% | **High** — no network in path |
| **Build** (`next build`) | `/login` First Load JS (gzip) | 349.9 kB | 312.0 kB | **−10.8%** | **High** — code-determined |
| **Lighthouse** staging `/login` | Performance score | 79 (ref) | 80 | — | Medium |
| **Lighthouse** staging `/login` | Total blocking time | — | 210 ms | — | High (low = good) |
| **Lighthouse** staging `/login` | Unused JavaScript | — | 0 KiB | — | High — split bundle confirmed |
| **Edge snapshot** staging, warm | median TTFB (public routes) | 1.23 s | 0.62 s | −49% | **Low** — cross-time, network-confounded |
| **Tests** | automated suite | — | 2,310 pass | — | — |

Per-route edge warm TTFB (staging, pre- vs post-deploy):

| Route | Before | After | Δ |
|---|---|---|---|
| `/login` | 2.510 s | 0.629 s | −75% |
| `/request-demo` | 2.356 s | 0.531 s | −77% |
| `/worker` | 1.440 s | 0.613 s | −57% |
| `/forgot-password` | 1.369 s | 0.626 s | −54% |
| `/` | 1.066 s | 0.621 s | −42% |
| `/dashboard` | 1.088 s | 0.718 s | −34% |
| `/partners` | 1.020 s | 0.535 s | −48% |
| `/signup` | 0.533 s | 0.640 s | +20% (noise) |

---

## 4 · Methodology & honest caveats

- **Test vantage is West Africa**, far from the origin — so anything involving the network path (edge TTFB, Lighthouse LCP) carries high variance and is dominated by round-trip time, not code. The Lighthouse LCP of ~4.2 s is network-bound, not a code signal.
- **The edge −49% is a cross-time comparison** (baseline one day, post-deploy the next). The pre-deploy baseline included erratic highs (`/login` 2.5 s, `/request-demo` 2.4 s) that likely reflect transient network slowness, inflating the delta. It is directionally strong but should not be quoted as a precise figure.
- **The trustworthy signals are network-free:** on-server TTFB (−45%), First Load JS (−10.8%), and 0 KiB unused JS / 210 ms TBT. These isolate the application change from the network and all confirm the work landed.
- **Not yet measured:** Tier 3's largest wins — 5.1 session-query reduction and 5.3's over-fetch fixes — live on **authenticated, query-heavy** pages that an unauthenticated probe never reaches. The definitive measurement is **`pg_stat_statements`** on the staging DB: compare query *count* and `mean_exec_time` for the affected shapes before/after. Recommended if hard query-level numbers are wanted; not required to consider the work done.

---

## 5 · Where the code lives

- **Merged to `dev`** and **deployed to `staging`**: all Tier 3 work.
- **Shipped PRs:** #425 (5.2), #427 (5.1/5.3/5.5), #428/#429 (getCourseById PII fix), #430 (dev→staging sync), #431 (`workflow_dispatch` for the staging deploy).
- **Not yet in production:** Tier 3 is staging-only; production promotion is the remaining rollout step.
- **New env flags:** `AUTH_REVALIDATE_TTL_SECONDS` (default 30), `ENROLLMENT_BATCH_ENABLED` (default off).

## 6 · Bugs found & fixed along the way

- **Certificate modal** action buttons were unclickable at the standard 1280×720 viewport (preview card overlapped them) — fixed, with an e2e regression guard.
- **`getCourseById` access-control gap** — the action returned the full staff roster (email/role/name/certificate) to any enrolled caller, including workers via a direct call. Now scoped to caller privilege; pre-existing, not introduced by this work.

## 7 · Remaining / recommended

1. **Promote Tier 3 to production** when ready (currently staging-only).
2. **Argo trial decision** at day 3–7: read the Cloudflare Traffic → Argo panel + re-measure dynamic TTFB; keep if ≥15–20% improvement, else disable (usage-billed).
3. **(Optional) `pg_stat_statements`** on staging/prod DB for hard before/after query-count numbers on the 5.1/5.3 wins.
4. **5.4 worker split** — schedule as its own infra track when prioritized.

---

*Theraptly LMS · Platform Speed Optimization Results · 2026-08-08 · internal*
