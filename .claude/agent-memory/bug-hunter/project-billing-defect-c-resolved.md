---
name: project-billing-defect-c-resolved
description: Defect C (resume never navigated to Overview) — RESOLVED; root cause was a next/dynamic lazy-load race, not the router.refresh()/replace() ordering theory first suspected
metadata:
  type: project
---

**Resolved** (was open as of 2026-07-16, fixed same day by code-ninja). Symptom: after a
successful resume/reactivate/plan-swap-in-place on the Subscription tab, `SubscriptionTab.tsx`
never navigated to `?tab=overview` — the URL stayed on `?tab=subscription` indefinitely, both
under `npm run dev` and a production `next build && next start`.

**My first hypothesis was wrong:** I initially concluded this was a `router.refresh()`
called-immediately-before-`router.replace()` race in the three handlers
(`handleSelectPlan`'s swap branch, `handleResumeSubscription`, `handleReactivateSubscription`).
Reordering to `onChangeTab(...); onMutated?.(); router.refresh();` did NOT fix it — same
failure, byte-identical symptom, on a verified re-run.

**Actual root cause (code-ninja, empirical):** `SubscriptionTab` was lazy-loaded via
`next/dynamic({ ssr: false })` in `BillingPage.tsx`. On a client-side tab switch its chunk
rendered late, so the e2e test's own `.last()` "Continue Plan" locator (used to disambiguate
from the site-wide `BillingPausedBanner`'s identically-labeled button — see
[[billing-phase4-defect-tests]]) transiently matched the WRONG element (the banner's
refresh-only button, not SubscriptionTab's) — the test was clicking the wrong thing, not
exercising a real app bug in isolation... except the underlying dynamic-import lazy-render
race was real and worth fixing regardless of the test artifact it caused.

**Fix:** `SubscriptionTab` is now a static import in `BillingPage.tsx` (the other three tabs —
Overview, BillingHistory, PaymentMethod — stay lazy via `next/dynamic`). Handlers now read
`onChangeTab('overview'); onMutated?.(); setTimeout(() => router.refresh(), 0);` in all three
mutation paths.

**How to apply:** if a future locator ambiguity re-appears against a lazily-mounted tab/panel
component in this app, suspect the `next/dynamic({ssr:false})` chunk-load race before assuming
it's a app-logic bug — verify with a static-import experiment before writing up a "confirmed
product bug" in this project's memory. Verified independently (fresh recheck, not just
code-ninja's self-report): `npx vitest run` still 110 files/1506 tests green (no ripple from
the dynamic→static swap), and `tests/e2e/billing-plan-change-and-gating.spec.ts` 4/4 green
against a live dev server with `E2E_TEST_BYPASS_RATE_LIMIT=true`.
