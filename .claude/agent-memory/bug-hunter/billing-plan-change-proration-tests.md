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

**(Historical) `isLessThanOneMonthRemaining` was removed** when the 2026-08-27 policy made every
upgrade `immediate_prorate`. The `setMonth` month-end overflow quirk (Mar 31 → "Feb 31" rolls to
Mar 3) still matters for `pauseEndDate()` and the test helper `periodEndFor`. Check for it in any
boundary test near a month end (see [[reminders-test-patterns]]).

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
`billing-plan-change-and-gating.spec.ts`, the new scheduled-banner e2e test deliberately does
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

**Policy reversed 2026-08-27.** Every tier upgrade now classifies `immediate_prorate` on every
cycle. Downgrades and same-tier cycle-only changes are `scheduled`. See
[[billing-deferred-pause-proration-tests]]. The 2026-07-17 "monthly upgrade always schedules"
rule and its t=0 boundary no longer exist. The `periodEndFor(start, cycle)` fixture helper
survives in `billing-plan-change.test.ts`, so a test's `currentPeriodEnd` stays consistent with
its `currentCycle`.

Full suite after this fix: **118 files / 1638 tests, 0 failures** (classifier file alone: 38/38).
