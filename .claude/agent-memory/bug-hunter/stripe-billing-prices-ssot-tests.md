---
name: stripe-billing-prices-ssot-tests
description: Test patterns for the "Stripe as single source of truth for billing prices" feature — server-only mocking gotcha, local env has no real Stripe test-mode keys, e2e self-skip pattern
metadata:
  type: project
---

Covers `src/lib/billing-price-format.test.ts`, `src/lib/billing-prices.test.ts`,
updates to `src/components/billing/SubscriptionTab.test.tsx`,
`src/app/dashboard/(main)/billing/page.test.tsx`, and
`src/app/api/billing/subscription/checkout/route.test.ts`, plus the new
`tests/e2e/billing-stripe-plan-prices.spec.ts`.

**`import 'server-only'` crashes ANY vitest test that transitively imports the
module, even through mocks of its dependencies.** `src/lib/billing-prices.ts`
is the first file in this repo to import the real `server-only` npm package.
Under vitest/jsdom the `react-server` resolve condition Next sets isn't
present, so `server-only`'s `index.js` (not the no-op `empty.js`) always
resolves and throws `"This module cannot be imported from a Client Component
module."` at import time — before any `vi.mock()` of the module's *own*
dependencies (stripe client, logger) can help, because the throw happens
before those mocks even matter. Fix: `vi.mock('server-only', () => ({}))` at
the top of any test file that imports `billing-prices.ts` directly (its own
unit test) OR indirectly (e.g. `page.tsx` imports `getPlanPrices` from it
un-mocked) — in the latter case it's usually simpler to
`vi.mock('@/lib/billing-prices', () => ({ getPlanPrices: vi.fn() }))` instead
of stubbing `server-only`, since the page test isn't exercising pricing logic
anyway. This exact crash pre-existed in `page.test.tsx` the moment
`page.tsx` started importing `getPlanPrices` — it was a real (if trivial)
regression from the feature landing, not a pre-existing gap.

**`import type` from a `server-only` module is always safe.**
`billing-price-format.ts` does `import type { StripePriceInfo } from
'@/lib/billing-prices'` — type-only imports are erased at compile time, so
testing `billing-price-format.ts` (or any client component that only imports
the *type* from `billing-prices.ts`, like `SubscriptionTab.tsx` /
`BillingPage.tsx`) never triggers the `server-only` runtime import. No mocking
needed for those.

**This sandbox has no real Stripe test-mode credentials.** `.env` ships all
`STRIPE_STARTER_*_PRICE_ID` / `STRIPE_PROFESSIONAL_*_PRICE_ID` vars as empty
strings; `.env.local` has a `STRIPE_SECRET_KEY` that is a short placeholder
(`sk_test_` + ~14 chars, not a real ~100+ char key). Consequence: the real
(unmocked) `fetchPlanPricesUncached()` running against the live dev server
always returns an all-empty `PlanPriceMap` — every plan card renders "Price
unavailable" for real, with no Stripe network calls actually succeeding
(price ids are empty/falsy so `if (priceId)` skips job creation entirely — no
jobs, no calls, no errors logged). This makes any e2e assertion of a specific
Stripe-derived dollar amount meaningless locally.

**E2E self-skip pattern for env-gated Stripe assertions.** Rather than
hardcoding an expected price or skipping the whole spec, the new
`tests/e2e/billing-stripe-plan-prices.spec.ts` detects real-vs-placeholder
credentials with `isRealStripeSecretKey()` (regex requiring 20+ chars after
`sk_test_`/`sk_live_`) and `isRealPriceId()`, then `test.skip(condition,
reason)` *inside* the test body only for the price-value assertion — a
separate, always-run test independently verifies the pre-fix regression
symptom (hardcoded `(-10%)`/`(-25%)` static labels on the cycle toggle) since
that check needs no Stripe data at all. When credentials ARE real, the test
independently calls the Stripe SDK (`stripe.prices.retrieve`, using the SAME
env vars the app server reads) to compute the expected `$X/mo` via the same
`effectiveMonthlyCents` formula as `billing-prices.ts`, so the assertion is
never a hardcoded number in either branch. Locally this correctly skips 1/2
tests; the deterministic core lives in the unit tests
([[stripe-billing-prices-ssot-tests]] itself / `billing-prices.test.ts`).

**Stale mock reconciliation:** `checkout/route.test.ts`'s
`vi.mock('@/lib/billing-plans')` factory had `monthlyPrice: 99/149` fields
left over from the deleted `BillingPlan.monthlyPrice` field. It ran green
as-is (loosely-typed mock object, route.ts never reads that field) — removed
for hygiene only, not a real bug.

**Pre-existing `SubscriptionTab.test.tsx` broke on this feature landing** (not
caused by this test session): it never passed a `planPrices` prop, so every
test crashed with `Cannot read properties of undefined (reading 'starter')`
once `SubscriptionTab.tsx` started indexing `planPrices[plan.key][cycle]`
unconditionally. Also its one price-specific assertion (`$74/mo` on a
Professional→Starter yearly swap) was computed from the now-deleted
`CYCLE_DISCOUNTS` hardcoded-25%-off-99 logic — coincidentally still `$74` in
the rewritten test only because the new `fullPlanPrices()` fixture was
deliberately chosen to reproduce that same number from realistic
Stripe-derived cents, not because any of the old hardcoded logic survived.

See also [[billing-phase4-defect-tests]] and [[project-billing-defect-c-resolved]]
for the SubscriptionTab/BillingPage locator and lazy-import gotchas from the
prior billing test round (still valid, unaffected by this change).
