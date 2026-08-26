---
name: billing-cancel-resume-seats-fix
description: 2026-08-25 plan for bugfix/billing-cancel-resume-seats — 4 QA defects (#25/#26/#29/#33), unifying root cause + seat-count fix
metadata:
  type: project
---

Branch `bugfix/billing-cancel-resume-seats` (off fresh `dev`) fixes 4 billing QA defects in one focused PR.

**Root cause (verified against Stripe docs, 2026-02-25.clover):** `stripe.subscriptions.update` rejects `cancel_at_period_end`/`pause_collection` when the subscription is attached to a live Subscription Schedule ("managed by the subscription schedule ... updating any cancelation behavior directly is not allowed"). `cancel`, `pause`, `resume`, `reactivate` routes all guarded on the LOCAL mirror column `subscription.stripeScheduleId` with an identical 409 ("pending plan change ... Cancel it first."). Local/Stripe drift on that column explains both the 409 (#26) and the unguarded-path 500 (#25). #29 ("paused plan can't restart") is very likely the SAME 409 hit via `resume/route.ts`'s copy of the guard — NOT a `pauseEndsAt` UI gate (confirmed absent in both `SubscriptionTab.tsx` and `OverviewTab.tsx`; neither disables Resume/Continue based on `pauseEndsAt`).

**Why:** future billing bugs that smell like "confusing 409" or "blocked until some future date" on cancel/pause/resume/reactivate should be checked against this same `stripeScheduleId` guard family before assuming a new root cause.

**Fix design:** new `src/lib/billing-schedule.ts` → `releasePendingSchedule(organizationId, stripeScheduleId)`. It RETRIEVES the schedule from Stripe first (source of truth, not the local mirror) — only calls `subscriptionSchedules.release` if status is `not_started`/`active`; otherwise treats it as already-resolved and just clears the local `scheduled*` columns. This makes cancel/resume/reactivate self-healing against drift AND idempotent under races, without a separate reconciliation job. `cancel`, `resume`, and (pending user confirmation) `reactivate` call this instead of hard-blocking; `pause` KEEPS its hard 409 guard (product decision: pausing mid-schedule stays ambiguous). `cancel-scheduled-change/route.ts` refactored to call the same helper (dedup + gains the same self-healing for free).

**Reactivate scope question (architect's opinion, given but not yet user-confirmed):** `reactivate/route.ts` has the identical guard/message and is reachable from the same `SubscriptionTab.tsx` "Resume subscription" affordance (the `!isPaused && isCancelScheduled` case, sibling of #29's paused case). Recommended INCLUDING it in this PR for consistency — same fix, same file shape, near-zero marginal cost, and excluding it leaves an identical bug live at a 4th call site with a near-certain follow-up QA ticket. Flagged explicitly to the orchestrator/user rather than silently added.

**Test traps (confirmed against a green baseline — 214 tests / 15 files before any change):** `cancel/route.test.ts`, `resume/route.test.ts`, and `reactivate/route.test.ts` each have a "scheduled-change guard" describe block asserting the OLD (buggy) 409-block behavior as correct — these MUST be rewritten to assert auto-release instead. `pause/route.test.ts`'s equivalent guard test is CORRECT and must NOT change. No `src/app/api/billing/overview/route.test.ts` exists at all (zero server-side coverage for the seat-count bug) — must be created from scratch.

**#33 seat-count fix:** `overview/route.ts:37` — drop the `role: { in: [...WORKER_ROLES] } }` clause from the `organizationUser.count()` where-clause, keep `active: true`. Implemented literally per the user's explicit code-level instruction, which counts ALL active roles including `owner` — flagged as a discrepancy against the user's prose list (which named admin/HR/finance/supervisor/clinicalDirector but not owner) since the literal code instruction is more precise. `OverviewTab.tsx` needs NO production changes (already renders `activeStaffCount` from the API); the near-limit (`isNearLimit >= 0.8`) banner will now correctly fire for orgs whose true staff count is high — that's the intended knock-on effect of fixing the undercount, not a new behavior to design.

See git history / the PR itself for final task list and outcome once merged.
