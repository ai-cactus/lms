---
name: billing-phase4-defect-tests
description: Test patterns for the Phase-4 billing defect fixes (plan-switch confirm dialog, billing-gated assignment, Overview refreshKey) — fixture pollution gotcha, ambiguous banner locators, e2e seeding
metadata:
  type: project
---

Context: `hasActiveBilling()` (`src/lib/billing.ts`, unchanged/pre-existing) gates
`enrollUsers` (`enrollment.ts`) and `assignCourseToUsers` (`course.ts`) — active only when
`status` is `active`/`trialing` AND `pausedAt` is null.

**Fixture-pollution trap (vitest, `mockResolvedValueOnce` chains):** adding the billing gate
to `enrollUsers` means any existing test fixture missing `organization.subscription` now
throws BEFORE the second/third queued `user.findUnique.mockResolvedValueOnce(...)` value is
consumed. `vi.clearAllMocks()` in `beforeEach` does NOT clear unconsumed once-queues, so the
leftover value silently leaks into and corrupts the NEXT test's mock sequence, producing
confusing unrelated-looking failures ("Forbidden" instead of the expected error) in tests
that never touched billing. Fix: every fixture reaching the gate needs `organization:
{ subscription: { status: 'active', pausedAt: null } }` (or matrix-specific values) — see
`src/app/actions/enrollment.test.ts` and `enrollment.assignment.test.ts`.

**Ambiguous locators from the site-wide paused banner:** `src/components/billing/
BillingPausedBanner.tsx` (rendered by the dashboard layout on every page while paused) and
`OverviewTab.tsx`'s own paused block use the EXACT SAME copy `"Your subscription is paused"`
and both render a `"Continue Plan"` button — so `page.getByText(...)`/`getByRole('button',
{name:'Continue Plan'})` match 2+ elements once paused-state UI is fully loaded. The banner
is always first in DOM order (rendered before `{children}` in the layout), so `.last()`
reliably targets the page's own element. For a final-state assertion after a mutation, don't
assert on the shared banner text (it's driven by real unmocked server-rendered DB state and
won't change from client-side route mocks) — assert on OverviewTab-only unique copy instead,
e.g. `"All your data is safely stored until you continue your plan."` vs the banner's
`"Access is limited until you continue your plan."`.

**Playwright `page.waitForURL()` vs client-side (search-param-only) navigation:**
`router.replace('?tab=x')` on this app's billing page is a pure client `useSearchParams()`
read, not a full page navigation — `page.waitForURL()` (which waits for a 'load' lifecycle
event by default) times out even once the URL already matches. Use `expect(page).toHaveURL(regex)`
(polling assertion, no lifecycle wait) instead.

**e2e seeding:** for billing-state variants beyond the stock seed (`prisma/seed.ts`'s
`admin@test.com` has an active professional sub with a real `stripeSubscriptionId`, i.e.
`hasLiveSubscription=true`), seed fresh orgs via raw `pg` Client (same pattern as
`rbac-role-change.spec.ts`) — `subscriptions` table needs `stripe_subscription_id` (unique,
NOT NULL) and `stripe_price_id` (NOT NULL) even for a throwaway row; a paused subscription
still needs `status='active'` (Stripe convention — `pausedAt` is the actual gate, see
`hasActiveBilling`). Freshly-seeded orgs never have a `stripe_customer_id`, so the real
`/api/billing/overview` route's Stripe customer lookup is skipped — the FIRST overview read
in a test can safely hit the real route (`route.continue()`) without any Stripe mocking.

**Tooling gotcha this session:** `command & echo $!` inside the Bash tool does NOT reliably
survive across tool calls (the background job can die when the tool call returns) — always
use the Bash tool's `run_in_background: true` parameter for anything you need to poll/await
across multiple tool calls, never manual shell `&`.

See also [[project-billing-defect-c-resolved]] for how the resume/reactivate/swap
navigation bug this locator ambiguity uncovered was actually rooted (next/dynamic lazy-load
race, not a router.refresh()/replace() ordering issue) and resolved.
