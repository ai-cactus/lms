/**
 * Unit tests for src/lib/stripe-invoice-period.ts
 *
 * deriveInvoiceServicePeriod covered:
 *   - A single subscription line's period wins over divergent invoice-level fields
 *   - Multi-line (proration + renewal, both subscription lines) → min(start)/max(end)
 *   - Mixed subscription + invoice-item lines → only subscription lines aggregated
 *   - Zero-width-only lines (point-in-time items) → invoice-level fallback
 *   - Empty `lines.data` and missing `lines` → invoice-level fallback
 *   - No subscription lines but a real-window invoice-item line → that line used
 *   - Nullish invoice-level fields → epoch-0 dates (documents the defensive `?? 0`)
 */
import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { deriveInvoiceServicePeriod, type InvoicePeriodSource } from './stripe-invoice-period';

// ─── Fixture builder ───────────────────────────────────────────────────────────

/**
 * Minimal-but-fully-typed InvoiceLineItem fixture. Stripe's type has many
 * required fields unrelated to period/parent derivation; this builder fills
 * them with plausible defaults so tests only need to override `period` and
 * `parent`.
 */
function invoiceLine(overrides: {
  period: Stripe.InvoiceLineItem['period'];
  parent?: Stripe.InvoiceLineItem['parent'];
  id?: string;
}): Stripe.InvoiceLineItem {
  return {
    id: overrides.id ?? 'il_test',
    object: 'line_item',
    amount: 1000,
    currency: 'usd',
    description: null,
    discount_amounts: null,
    discountable: true,
    discounts: [],
    invoice: 'in_test',
    livemode: false,
    metadata: {},
    parent: overrides.parent ?? null,
    period: overrides.period,
    pretax_credit_amounts: null,
    pricing: null,
    quantity: 1,
    subscription: null,
    subtotal: 1000,
    taxes: null,
  } as Stripe.InvoiceLineItem;
}

/** A `parent` marking the line as a subscription-item line (renewal/proration). */
function subscriptionParent(): Stripe.InvoiceLineItem['parent'] {
  return {
    type: 'subscription_item_details',
    subscription_item_details: {
      invoice_item: null,
      proration: false,
      proration_details: null,
      subscription: 'sub_test',
      subscription_item: 'si_test',
    },
    invoice_item_details: null,
  };
}

/** A `parent` marking the line as a one-off invoice-item line. */
function invoiceItemParent(): Stripe.InvoiceLineItem['parent'] {
  return {
    type: 'invoice_item_details',
    invoice_item_details: {
      invoice_item: 'ii_test',
      proration: false,
      proration_details: null,
      subscription: null,
    },
    subscription_item_details: null,
  };
}

/** Builds a minimal InvoicePeriodSource with the given lines and invoice-level period. */
function invoiceSource(
  lines: Stripe.InvoiceLineItem[] | null | undefined,
  invoiceLevel: { period_start?: number | null; period_end?: number | null } = {},
): InvoicePeriodSource {
  return {
    // Distinguish "key omitted" (use the default) from "explicitly null"
    // (pass the null through) so callers can exercise the `?? 0` fallback.
    period_start: 'period_start' in invoiceLevel ? invoiceLevel.period_start! : 1_700_000_000,
    period_end: 'period_end' in invoiceLevel ? invoiceLevel.period_end! : 1_700_000_100, // near-equal to period_start
    lines: lines === null ? null : { data: lines ?? [] },
  };
}

describe('deriveInvoiceServicePeriod', () => {
  it('uses the single subscription line period over divergent invoice-level fields', () => {
    const start = 1_700_000_000;
    const end = 1_702_592_000; // ~30 days later
    const source = invoiceSource(
      [invoiceLine({ period: { start, end }, parent: subscriptionParent() })],
      { period_start: 1_700_000_050, period_end: 1_700_000_060 }, // near-equal, would be wrong
    );

    const result = deriveInvoiceServicePeriod(source);

    expect(result.periodStart).toEqual(new Date(start * 1000));
    expect(result.periodEnd).toEqual(new Date(end * 1000));
  });

  it('spans min(start)/max(end) across multiple subscription lines (proration + renewal)', () => {
    const prorationLine = invoiceLine({
      id: 'il_proration',
      period: { start: 1_699_000_000, end: 1_700_000_000 },
      parent: subscriptionParent(),
    });
    const renewalLine = invoiceLine({
      id: 'il_renewal',
      period: { start: 1_700_000_000, end: 1_702_592_000 },
      parent: subscriptionParent(),
    });
    const source = invoiceSource([prorationLine, renewalLine]);

    const result = deriveInvoiceServicePeriod(source);

    expect(result.periodStart).toEqual(new Date(1_699_000_000 * 1000));
    expect(result.periodEnd).toEqual(new Date(1_702_592_000 * 1000));
  });

  it('aggregates only subscription lines when the invoice mixes subscription and invoice-item lines', () => {
    // The invoice-item line has a WIDER window than the subscription line; if it
    // leaked into the aggregation it would win min/max and this assertion would
    // fail, proving the filter is applied.
    const subLine = invoiceLine({
      id: 'il_sub',
      period: { start: 1_700_000_000, end: 1_702_592_000 },
      parent: subscriptionParent(),
    });
    const invoiceItemLine = invoiceLine({
      id: 'il_one_off',
      period: { start: 1_600_000_000, end: 1_800_000_000 },
      parent: invoiceItemParent(),
    });
    const source = invoiceSource([invoiceItemLine, subLine]);

    const result = deriveInvoiceServicePeriod(source);

    expect(result.periodStart).toEqual(new Date(1_700_000_000 * 1000));
    expect(result.periodEnd).toEqual(new Date(1_702_592_000 * 1000));
  });

  it('falls back to invoice-level fields when all lines are zero-width (point-in-time)', () => {
    const zeroWidth = invoiceLine({
      period: { start: 1_700_000_000, end: 1_700_000_000 },
      parent: subscriptionParent(),
    });
    const source = invoiceSource([zeroWidth], {
      period_start: 1_700_000_050,
      period_end: 1_700_000_060,
    });

    const result = deriveInvoiceServicePeriod(source);

    expect(result.periodStart).toEqual(new Date(1_700_000_050 * 1000));
    expect(result.periodEnd).toEqual(new Date(1_700_000_060 * 1000));
  });

  it('falls back to invoice-level fields when lines.data is empty', () => {
    const source = invoiceSource([], { period_start: 1_700_000_050, period_end: 1_700_000_060 });

    const result = deriveInvoiceServicePeriod(source);

    expect(result.periodStart).toEqual(new Date(1_700_000_050 * 1000));
    expect(result.periodEnd).toEqual(new Date(1_700_000_060 * 1000));
  });

  it('falls back to invoice-level fields when lines is missing entirely', () => {
    const source = invoiceSource(null, { period_start: 1_700_000_050, period_end: 1_700_000_060 });

    const result = deriveInvoiceServicePeriod(source);

    expect(result.periodStart).toEqual(new Date(1_700_000_050 * 1000));
    expect(result.periodEnd).toEqual(new Date(1_700_000_060 * 1000));
  });

  it('uses an invoice-item line with a real window when there are no subscription lines', () => {
    const invoiceItemLine = invoiceLine({
      period: { start: 1_700_000_000, end: 1_700_500_000 },
      parent: invoiceItemParent(),
    });
    const source = invoiceSource([invoiceItemLine], {
      period_start: 1_700_000_050,
      period_end: 1_700_000_060,
    });

    const result = deriveInvoiceServicePeriod(source);

    expect(result.periodStart).toEqual(new Date(1_700_000_000 * 1000));
    expect(result.periodEnd).toEqual(new Date(1_700_500_000 * 1000));
  });

  it('defaults nullish invoice-level fields to epoch-0 dates when there are no usable lines', () => {
    const source = invoiceSource([], { period_start: null, period_end: null });

    const result = deriveInvoiceServicePeriod(source);

    expect(result.periodStart).toEqual(new Date(0));
    expect(result.periodEnd).toEqual(new Date(0));
  });
});
