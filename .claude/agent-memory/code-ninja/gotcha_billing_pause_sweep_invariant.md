---
name: billing-pause-sweep-invariant
description: pauseStartsAt must NEVER be read by hasActiveBilling/getPauseState — that separation is the whole mechanism, and it is easy to "helpfully" break
metadata:
  type: feedback
---

`hasActiveBilling()` in `src/lib/billing.ts` must never read `Subscription.pauseStartsAt`. Same for `getPauseState()`. Use the UI-only `hasPendingPause()` instead.

**Why:** `hasActiveBilling` is the single choke point every access gate funnels through — worker portal, quiz submit, enrollment creation, course-assign redirect, `hasAuditorAccess`. A pending pause is supposed to change *nothing* about access until the boundary arrives ([[billing-2026-08-27-decisions]]). Teaching that one function about `pauseStartsAt` would instantly revoke access across the whole product the moment a pause is merely *scheduled* — the exact bug the separate column exists to prevent. It looks like a one-line consistency fix, which is what makes it dangerous.

**How to apply:** when adding pending-pause awareness anywhere, ask whether the caller *gates* or *displays*. Gating → leave it alone. Displaying → `hasPendingPause()`. Both functions carry ⛔ comments saying so; do not delete them. Related traps in the same feature:
- The Stripe webhook's `handleSubscriptionUpsert` deliberately omits `pauseStartsAt` from both upsert branches, so a portal-originated event cannot clobber a pending pause.
- The sweep writes `pausedAt = the row's pauseStartsAt`, NOT the sweep's wall clock, so the window matches what the admin was shown.
- The sweep's 5-minute early cutoff is deliberate: a late run would let Stripe renew and CHARGE for the period being paused through.
- The resume route's pending branch must return BEFORE the `stripeScheduleId` release logic (that path was verified against real Stripe in #525).
