import type Stripe from 'stripe';

/**
 * Derive the service period a Stripe invoice actually covers.
 *
 * Stripe exposes two different "periods" on an invoice and they mean different
 * things. The invoice-level `period_start`/`period_end` reflect *invoice
 * assembly* time — for a subscription renewal these are (near-)equal and do NOT
 * describe the window the customer paid for. The real service window lives on
 * the **line items** (`inv.lines.data[n].period.start/.end`); in the pinned
 * `2026-02-25.clover` SDK every `InvoiceLineItem` carries a non-optional
 * `period`, and `parent.type` discriminates a `subscription_item_details` line
 * (the renewal we want) from an `invoice_item_details` line (one-off charges,
 * prorations booked as invoice items, etc.). This mirrors the analogous
 * 2026-SDK relocation already handled for subscriptions in the webhook route
 * (see the `current_period_*` comment in
 * src/app/api/webhooks/stripe/route.ts) — there the fields moved from the
 * Subscription onto the SubscriptionItem; here the trustworthy dates live on
 * the line items rather than the invoice envelope.
 *
 * Caveat: `inv.lines` is a paginated list that only inlines its first page (up
 * to 10 items). A pathological invoice with >10 lines would have its later
 * lines truncated here. That is acceptable for this app — its subscription
 * invoices carry a single line — and any outlier is healed by a webhook replay
 * or the backfill script, both of which re-derive from whatever page is
 * available. The structural `InvoicePeriodSource` type keeps webhook payloads,
 * `invoices.retrieve()` responses, and test fixtures all assignable.
 */
export type InvoicePeriodSource = Pick<Stripe.Invoice, 'period_start' | 'period_end'> & {
  lines?: { data: Stripe.InvoiceLineItem[] } | null;
};

export function deriveInvoiceServicePeriod(inv: InvoicePeriodSource): {
  periodStart: Date;
  periodEnd: Date;
} {
  const lines = inv.lines?.data ?? [];

  // Exclude zero-width, point-in-time line items (period.end === period.start),
  // which carry no meaningful service window.
  const usable = lines.filter((line) => line.period.end > line.period.start);

  // Prefer subscription lines (the actual recurring service window); fall back
  // to any usable line (e.g. an invoice-item-only invoice with a real window).
  const subLines = usable.filter((line) => line.parent?.type === 'subscription_item_details');
  const chosen = subLines.length > 0 ? subLines : usable;

  if (chosen.length > 0) {
    // min(start)/max(end) spans multi-line invoices (e.g. proration + renewal on
    // an upgrade) and degenerates to the single line's period for the normal
    // 1-line invoice this app issues.
    const start = Math.min(...chosen.map((line) => line.period.start));
    const end = Math.max(...chosen.map((line) => line.period.end));
    return { periodStart: new Date(start * 1000), periodEnd: new Date(end * 1000) };
  }

  // Fallback: invoice-level fields. Never worse than the pre-fix behaviour.
  return {
    periodStart: new Date((inv.period_start ?? 0) * 1000),
    periodEnd: new Date((inv.period_end ?? 0) * 1000),
  };
}
