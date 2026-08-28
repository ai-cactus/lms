---
name: billing-2026-08-27-decisions
description: Two final product decisions reversing/extending earlier billing policy — upgrades prorate immediately, pauses defer to period end via a sweep
metadata:
  type: project
---

Two user-approved, FINAL product decisions taken 2026-08-27, implemented on `feature/billing-upgrade-proration-and-deferred-pause`.

**1. Tier upgrades apply immediately with a prorated charge — REVERSES the 2026-07-17 policy.**
`classifyPlanChange`'s upgrade branch now returns `immediate_prorate` unconditionally.

**Why:** the old "< 1 calendar month remaining → schedule it" gate silently swallowed *every* monthly upgrade, because a monthly period IS exactly one month. Admins who upgraded for capacity today did not get it. The old code carried an emphatic "INTENDED per product decision (2026-07-17)… do NOT fix this without re-confirming the policy" comment; the user re-confirmed the reversal and that comment was replaced.

**How to apply:** if you find a comment, test, or doc arguing that monthly upgrades must defer to renewal, it is stale — 2026-08-27 supersedes it. Downgrades and same-tier cycle changes still `scheduled`.

**2. A pause takes effect at the END of the current paid period; restart stays immediate.**
`Subscription.pauseStartsAt` = pending (full access continues); `pausedAt` = active pause. Stripe's native scheduled pause is unusable here (needs a preview API version + flexible billing mode; project is pinned to `2026-02-25.clover`, and `pause_collection` cannot live in a schedule phase), so a BullMQ sweep flips it — see [[billing-pause-sweep-invariant]].

**Why:** the org paid for the period; revoking access the moment a pause is *requested* takes away time they bought.

**How to apply:** `BILLING_PAUSE_SWEEP_ENABLED` must be true in any environment where pauses are expected to take effect — disabling it means requested pauses NEVER apply and orgs keep being billed. Related deliberate non-fixes are catalogued in [[billing-schedule-deferred-scope]]; note that memory's "checkout's missing pausedAt check" item is now CLOSED (the checkout route 409s on `pausedAt || pauseStartsAt`).
