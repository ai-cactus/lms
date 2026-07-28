---
name: billing-4tier-rename-test-updates
description: Test-suite fallout from the 3-tier -> 4-tier billing rename (professional->growth, new pro inserted) — price-id naming collision trap, invite.test.ts 'pro' fixture collision, enum RENAME VALUE gotcha
metadata:
  type: project
---

2026-07-28: plan keys moved from `starter | professional | enterprise` to
`starter | growth | pro | enterprise` (`professional` renamed to `growth`,
same 11–50 staff band; new `pro` inserted at 51–150; enterprise now starts at
151). Prisma migration `20260728120000_update_subscription_plan_tiers` does
`ALTER TYPE "SubscriptionPlan" RENAME VALUE 'professional' TO 'growth'` +
`ADD VALUE 'pro'` — after it applies, the literal `'professional'` is GONE
from the enum, so any raw-SQL e2e seed (`'professional'::"SubscriptionPlan"`)
throws at insert time, not just a stale-name annoyance. All raw-seeded e2e
specs (`worker-billing-gate`, `remove-reinvite-clean-slate`,
`assign-course-invite`, `rbac-dual-cookie-login`, `documents-hub-rbac-gate`,
`billing-plan-change-and-gating`) needed that literal swapped to `'growth'`.

**Price-id naming collision trap (checkout/route.test.ts and
preview-plan-change/route.test.ts).** Both mocked `BILLING_PLANS` fixtures had
already named the OLD `professional` plan's Stripe price ids
`price_pro_monthly/q/y` (a pre-existing, harmless-at-the-time shorthand for
"professional"). Once a REAL `pro` tier exists, reusing those same literal
price-id strings for the new tier's fixture would silently alias two
different plans onto identical ids and produce false-positive assertions.
Fix applied: renamed the renamed-plan's ids to `price_growth_*` first, THEN
introduced `pro`'s own fixture with `price_pro_*` — order matters so a
sed/rename pass doesn't clobber one with the other.

**invite.test.ts had an unrelated pre-existing `'pro'` fixture key meaning
"unlimited seats"** (`{ key: 'pro', name: 'Pro', staffMax: null }`), used only
to satisfy `BILLING_PLANS.find()` lookups, never actually exercised by any
seat-count assertion in that file. This is NOT the same semantic as the real
4-tier `pro` (finite 150-seat cap) — left as-is it would silently mislead a
future reader. Renamed that unused fixture entry to `'enterprise'` (matching
its actual null-staffMax semantics) and added a real `{ key: 'pro', staffMax:
150 }` entry plus a dedicated "pro seat cap 150" describe block, since no
`seat-limits.ts` dedicated test file exists — `invite.test.ts` is the only
place seat-limit enforcement against the real plan bands gets exercised.

**Tests that use OPAQUE plan-key fixtures need no behavioral care, just a
rename.** Most `.test.tsx` files carrying `plan: 'professional'` (OverviewTab,
billing/page, settings/page) never assert on the derived display name/price —
those are simple `sed 's/professional/growth/'` renames. Only files that
either (a) mock `BILLING_PLANS` themselves with a hand-built plan list, or (b)
assert on rendered `$X` amounts / band ceilings, need the fuller price-id and
staffMax rework described above.

**e2e run confirmed clean**: `billing-plan-change-and-gating.spec.ts` (12,
1 self-skip — the real-Stripe-price test, same pre-existing environment gate
as before), `billing-stripe-plan-prices.spec.ts`, `worker-billing-gate.spec.ts`,
`remove-reinvite-clean-slate.spec.ts`, `assign-course-invite.spec.ts`,
`rbac-dual-cookie-login.spec.ts`, `documents-hub-rbac-gate.spec.ts` all green
against a real migrated `lms_e2e` DB + prod build, using the same
container/env mapping as [[e2e-local-verification-runbook]].

See also [[stripe-billing-prices-ssot-tests]] (env var names there now
corrected from `STRIPE_PROFESSIONAL_*` to `STRIPE_GROWTH_*`/`STRIPE_PRO_*`).
