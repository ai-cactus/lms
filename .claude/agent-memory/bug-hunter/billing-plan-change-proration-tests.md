---
name: billing-plan-change-proration-tests
description: Test patterns for the Phase-4/Issue-3 plan-change classifier + proration policy (billing-plan-change.ts, checkout/preview/cancel-scheduled-change routes, webhook carry-forward, SubscriptionTab async preview flow)
metadata:
  type: project
---

Covers `src/lib/billing-plan-change.test.ts` (new), `src/lib/billing-price-format.test.ts`
(added `formatCents`), `checkout/route.test.ts` (full rewrite — see below),
`preview-plan-change/route.test.ts` (new), `cancel-scheduled-change/route.test.ts` (new),
`pause|cancel|resume/route.test.ts` (new — 409 scheduled-change guard), `reactivate/route.test.ts`
(extended with the same guard), `webhooks/stripe/route.test.ts` (added a carry-forward
preserve/clear describe block), `SubscriptionTab.test.tsx` (plan-switch dialog + banner
sections rewritten for the async preview flow), and `tests/e2e/billing-plan-change-and-gating.spec.ts`
(Defect-A group rewritten + new scheduled-banner e2e test).

**A "modified" pre-existing route test can be completely stale after a route rewrite, even
when `git diff` shows almost no line changes against HEAD.** `checkout/route.test.ts` showed
up in `git status` as modified with only a 2-line diff from HEAD, but the route itself
(`route.ts`) had been rewritten wholesale (single unconditional swap → three-branch
`classifyPlanChange` dispatch). The tiny diff meant nothing — the ENTIRE test file was
asserting on response shapes/Stripe calls (`proration_behavior: 'create_prorations'`,
unconditional `{updated:true, message:'Your plan has been updated.'}`) that no longer existed
in the route at all. Don't infer "still current" from a small `git diff` on a test file —
always diff the test's assertions against the CURRENT route/component body when the file under
test changed significantly, regardless of how small the test file's own working-tree diff looks.

**`isLessThanOneMonthRemaining`'s `setMonth` calendar-month arithmetic has the same
month-length-overflow quirk as `pauseEndDate()` (see [[reminders-test-patterns]]'s DST/midnight
note).** `new Date(2026-03-31).setMonth(1)` (target: February) overflows the nonexistent Feb 31
forward into March, landing on **Mar 3** (2026 is not a leap year → Feb has 28 days), not the
naively-expected Feb 28. Pinned as a documented-behavior test rather than treated as a bug —
consistent with the codebase's own comment ("consistent with `pauseEndDate()` in billing.ts").
Any future `now`/period-end boundary math test in this codebase should check for this overflow
pattern near month-end dates.

**Product-level UI coverage gap (reported, not fixed — code-ninja's call):** in
`SubscriptionTab.tsx`, a plan card's Subscribe button is disabled whenever
`currentPlan === plan.key`, **regardless of the selected billing-cycle toggle**. This means the
`scheduled` classification's "same-tier, cycle-only change" branch (see
`classifyPlanChange` — e.g. switching the CURRENT plan from monthly to yearly) is **not
reachable by clicking any plan card in the current UI** — the current-plan card is always
disabled, cycle or not. The backend (checkout/preview routes) fully supports this branch and it
is unit-tested directly; the confirmation-dialog's copy for it was verified via a mocked preview
response rather than a real click-driven state (the component trusts whatever classification the
server returns, so this is still a valid UI-rendering-contract test, just not evidence the branch
is reachable end-to-end today). Flagged for awareness — not something bug-hunter fixes.

**`handleCancelScheduledChange`'s post-mutation navigation (`onChangeTab('overview');
onMutated?.(); setTimeout(() => router.refresh(), 0)`) intermittently takes several seconds
(observed once >20s) to commit the URL under `next dev`**, even though it's the exact same
code shape already used by resume/reactivate (see [[project-billing-defect-c-resolved]], which
concluded that pattern was "fixed"). It flaked in a full-spec run but passed reliably in
isolation and on retries — looks like `next dev` compile/HMR background activity, not a logic
bug (this session did not modify product code to chase it). Because the exact same
navigation-timing mechanics are already covered by the existing "Defect C" resume e2e test in
`billing-plan-change-and-gating.spec.ex`, the new scheduled-banner e2e test deliberately does
**not** re-assert the final `?tab=overview` URL — it stops at "the cancel-scheduled-change fetch
fired and no inline error appeared," to avoid duplicating flake-prone coverage of a mechanism
that's already pinned elsewhere.

**`getByRole('alert')` also matches Next's own route-announcer div** (see
[[partners-feature-test-patterns]]) — reused that gotcha's fix (`.filter({ hasText: ... })`)
here too when asserting "no inline error shown."

**Full suite after this session: 118 files / 1632 tests, 0 failures** (was 110 files / 1536
tests, 8 pre-existing failures from the async `handlePlanCardClick` change breaking
`SubscriptionTab.test.tsx` and the stale `checkout/route.test.ts`, before this session's fixes).
`billing/page.test.tsx` was flagged by code-ninja as also broken by the async change but turned
out to already be green — it fully mocks `@/components/billing/BillingPage`, so it never
renders `SubscriptionTab` and was never exposed to the async preview flow at all; verify a
claimed regression against the actual mock boundary before assuming a fix is needed.

See also [[billing-phase4-defect-tests]], [[project-billing-defect-c-resolved]], and
[[stripe-billing-prices-ssot-tests]] for the surrounding Phase-4 billing test history.

**2026-07-17 follow-up — cycle-consistency invariant bug in the original test file, now fixed.**
A live QA run found the original `classifyPlanChange` upgrade tests asserted `immediate_prorate`
using a `currentPeriodEnd` picked independently of `currentCycle` (e.g. `currentCycle: 'monthly'`
paired with a `currentPeriodEnd` 2+ months out) — a combination that can never occur for a real
subscription, since a monthly subscription's period end is always exactly `start + 1 month`.
Confirmed as a **test-only bug, not a product bug**: product owner confirmed (2026-07-17) that a
MONTHLY tier upgrade is INTENDED to always resolve to `scheduled` (runs to end of month, charged
at renewal) — `immediate_prorate` is only reachable for quarterly/yearly cycles. Fixed by adding a
`periodEndFor(start, cycle)` helper (same `setMonth` arithmetic as the product code) so every
upgrade-classification test derives `currentPeriodEnd` from a realistic subscription start tied to
its cycle, and added an explicit "monthly upgrade always schedules" describe block as the
anti-regression guard, plus quarterly/yearly early-vs-final-month describe blocks.

**Non-obvious boundary gotcha found while building the fix:** classification depends only on
`currentCycle` (via `currentPeriodEnd`), **never on `targetCycle`** — so a monthly→yearly upgrade
still always schedules; only the CURRENT cycle matters. Also: at the **exact literal instant** a
billing period starts (`now === periodStart`, 0 elapsed time), `isLessThanOneMonthRemaining`
returns **false** (exactly 1 month remains, and the comparison is strict `>`), so the classifier
would return `immediate_prorate` at that one exact instant — the "monthly always schedules"
guarantee only holds for `now` strictly *after* period start, not at t=0. Verified numerically
before writing assertions; the new monthly-upgrade test cases deliberately start at `start + 1ms`
rather than `start` itself to avoid asserting a false invariant.

Full suite after this fix: **118 files / 1638 tests, 0 failures** (classifier file alone: 38/38).
