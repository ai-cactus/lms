---
name: stripe-invoice-period-test-patterns
description: Fixture patterns for testing Stripe invoice line-item period derivation (deriveInvoiceServicePeriod + the invoice.paid/payment_failed webhook path)
metadata:
  type: project
---

Covers `src/lib/stripe-invoice-period.test.ts` (pure unit) and the
`invoice line-item period derivation` describe block added to
`src/app/api/webhooks/stripe/route.test.ts`.

**Full `Stripe.InvoiceLineItem` fixture typing.** `node_modules/stripe/types/InvoiceLineItems.d.ts`
declares many required fields unrelated to period/parent (amount, currency,
discounts, metadata, pricing, subtotal, taxes, ...). A minimal typed builder
needs to fill all of them with plausible defaults and only expose `period`/
`parent`/`id` as overrides — otherwise you're fighting the type on every test.
`Stripe.InvoiceLineItem['parent']` has two variants
(`subscription_item_details` vs `invoice_item_details`) each with their own
required sub-fields (e.g. `subscription_item_details.subscription_item`,
`invoice_item_details.invoice_item`); build one helper per variant
(`subscriptionParent()` / `invoiceItemParent()`) rather than inlining.

**`?? default` fixture-helper trap.** A test-fixture builder that does
`overrides.period_start ?? 1_700_000_000` cannot represent "explicitly pass
null" — nullish coalescing treats an explicit `null` the same as "omitted".
To test the product code's own `inv.period_start ?? 0` fallback, the fixture
builder must distinguish "key omitted" from "key present with value null"
via `'period_start' in overrides ? overrides.period_start! : default`.
This bit on the first run (a "defaults nullish invoice-level fields to
epoch-0" test failed because the helper silently defaulted `null` back to a
non-null value) — it was a test-fixture bug, not a product bug.

**Webhook route.test.ts doesn't need `@/lib/audit` mocked.** `audit()` in
`src/lib/audit.ts` is a best-effort side-channel: it swallows any error from
`prisma.auditLog.create(...)` internally (try/catch + logger.error) and
always resolves. The existing `route.test.ts` `prismaMock` never defines an
`auditLog` delegate, so the call throws `TypeError: Cannot read properties of
undefined`, gets caught inside `audit()`, and the POST handler proceeds
normally to 200. No `vi.mock('@/lib/audit')` needed unless a test wants to
assert on audit-log content specifically.

**Regression-pinning idiom for "derived value must differ from raw input".**
For the billing-history period bug (webhook was persisting invoice-level
`period_start`≈`period_end` instead of the line-item service window), the
most valuable assertion isn't just "upsert was called with X" — it's an
explicit `expect(call.create.periodStart).not.toEqual(call.create.periodEnd)`
pulled from `prismaMock.invoice.upsert.mock.calls[0]![0]`. That directly
encodes the bug symptom (equal start/end dates) and fails immediately if a
future change reintroduces it, even if the "called with" assertion is
loosened later.

See also [Test Framework & Patterns](project-test-framework.md) for the
general `vi.hoisted()` mocking convention this file follows.
