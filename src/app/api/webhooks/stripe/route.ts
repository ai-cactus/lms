import { NextRequest, NextResponse } from 'next/server';
import { getStripeClient } from '@/lib/stripe';
import prisma from '@/lib/prisma';
import Stripe from 'stripe';
import { logger } from '@/lib/logger';
import { audit } from '@/lib/audit';
import { MAX_PAUSE_MONTHS, pauseEndDate } from '@/lib/billing';
import { deriveInvoiceServicePeriod } from '@/lib/stripe-invoice-period';
import type {
  SubscriptionPlan,
  SubscriptionBillingCycle,
  SubscriptionStatus,
} from '@/generated/prisma/enums';

// Stripe webhook secret — required to verify event authenticity
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * True for a Prisma unique-constraint violation (code `P2002`). Used to treat a
 * concurrent duplicate webhook delivery — one that races to record the same
 * event id — as already-processed rather than a failure. Duck-typed so it does
 * not depend on the generated Prisma error class import.
 */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function POST(request: NextRequest) {
  if (!webhookSecret) {
    logger.error({ msg: '[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured' });
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ msg: `[Stripe Webhook] Signature verification failed: ${message}` });
    return NextResponse.json({ error: `Webhook error: ${message}` }, { status: 400 });
  }

  // Idempotency: Stripe delivers events at-least-once and redelivers on any
  // non-2xx. If we've already recorded this event id, acknowledge and skip
  // re-processing so handlers run at most once.
  const alreadyProcessed = await prisma.processedWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
    select: { id: true },
  });
  if (alreadyProcessed) {
    logger.info({
      msg: '[Stripe Webhook] Duplicate event ignored (already processed)',
      stripeEventId: event.id,
      eventType: event.type,
    });
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpsert(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: 'canceled' },
        });
        // Revoke auditor access when subscription is fully canceled
        await handleAuditorAccessRevoke(sub);
        break;
      }
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        await handleInvoiceUpsert(inv, 'paid');
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        await handleInvoiceUpsert(inv, 'uncollectible');
        break;
      }
      default:
        // Unhandled event type — acknowledge receipt without error
        break;
    }

    // Record the event as processed ONLY after the handler succeeds, so a
    // failed handler can be safely redelivered and retried by Stripe.
    await prisma.processedWebhookEvent.create({
      data: { stripeEventId: event.id, eventType: event.type },
    });

    // F-001: record the system-driven billing change. Actor is Stripe/system
    // (no session, no ip/ua). Org is resolved best-effort from event metadata.
    const eventObject = event.data.object as { metadata?: Record<string, string> | null };
    await audit({
      action: `billing.webhook.${event.type}`,
      actorRole: 'system',
      organizationId: eventObject.metadata?.organizationId,
      targetType: 'stripe_event',
      targetId: event.id,
      metadata: { eventType: event.type },
    });
  } catch (error) {
    // A concurrent delivery may have recorded this same event between our
    // dedupe check and here — the unique constraint makes that safe to treat as
    // already-processed rather than a failure.
    if (isUniqueConstraintError(error)) {
      logger.info({
        msg: '[Stripe Webhook] Concurrent duplicate — already processed',
        stripeEventId: event.id,
        eventType: event.type,
      });
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Return 5xx so Stripe redelivers. The prior behavior returned 200 here,
    // which permanently swallowed transient/DB failures and left billing state
    // desynced with no chance of retry. Handlers are idempotent (upserts plus
    // the dedupe ledger above), so a redelivery is safe.
    logger.error({
      msg: `[Stripe Webhook] Retryable failure handling event ${event.type}`,
      err: error,
      stripeEventId: event.id,
    });
    return NextResponse.json({ error: 'Event processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

type SubscriptionDiscountFields = {
  discountPromoCode: string | null;
  discountCouponName: string | null;
  discountPercentOff: number | null;
  discountAmountOff: number | null;
  discountCurrency: string | null;
  discountDuration: string | null;
  discountEndsAt: Date | null;
};

const NO_DISCOUNT: SubscriptionDiscountFields = {
  discountPromoCode: null,
  discountCouponName: null,
  discountPercentOff: null,
  discountAmountOff: null,
  discountCurrency: null,
  discountDuration: null,
  discountEndsAt: null,
};

// Webhook payloads carry `discounts` as ID strings only (Stripe never expands
// event objects), so when a discount is present retrieve the subscription once
// with coupon + promotion code expanded. All-null when no discount, so the
// upsert clears stale values automatically.
async function extractDiscountFields(
  sub: Stripe.Subscription,
): Promise<SubscriptionDiscountFields> {
  if (!sub.discounts || sub.discounts.length === 0) return NO_DISCOUNT;

  const expanded = await getStripeClient().subscriptions.retrieve(sub.id, {
    expand: ['discounts.promotion_code', 'discounts.source.coupon'],
  });

  // Only the first (subscription-level) discount is displayed; Checkout promo
  // entry applies at most one.
  const discount = expanded.discounts.find((d): d is Stripe.Discount => typeof d !== 'string');
  if (!discount) return NO_DISCOUNT;

  const coupon = typeof discount.source.coupon === 'string' ? null : discount.source.coupon;
  const promo = typeof discount.promotion_code === 'string' ? null : discount.promotion_code;

  return {
    discountPromoCode: promo?.code ?? null,
    discountCouponName: coupon?.name ?? null,
    discountPercentOff: coupon?.percent_off ?? null,
    discountAmountOff: coupon?.amount_off ?? null,
    discountCurrency: coupon?.currency ?? null,
    discountDuration: coupon?.duration ?? null,
    discountEndsAt: discount.end ? new Date(discount.end * 1000) : null,
  };
}

async function handleSubscriptionUpsert(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const organization = await prisma.organization.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  if (!organization) {
    logger.warn({ msg: `[Stripe Webhook] No organization found for customer: ${customerId}` });
    return;
  }

  const planKey = ((sub.metadata?.planKey as string) ?? 'starter') as SubscriptionPlan;
  const billingCycle = ((sub.metadata?.billingCycle as string) ??
    'monthly') as SubscriptionBillingCycle;
  const priceItem = sub.items.data[0];
  const stripePriceId = priceItem?.price.id ?? '';

  // In Stripe SDK 2026, current_period_start/end moved from Subscription to SubscriptionItem
  const periodStart = priceItem?.current_period_start ?? sub.billing_cycle_anchor;
  const periodEnd = priceItem?.current_period_end ?? sub.billing_cycle_anchor;

  // Stripe keeps a paused subscription's status as `active` and only sets
  // `pause_collection`. Track that explicitly so the billing gate is restored
  // while paused, and cleared again the moment billing resumes. Preserve the
  // pause window (pausedAt/pauseEndsAt) set by our pause route rather than
  // overwriting it; only initialise pausedAt if Stripe reports a pause we don't
  // yet know about (e.g. paused directly from the Stripe portal).
  const isPaused = !!sub.pause_collection;
  const existing = await prisma.subscription.findUnique({
    where: { organizationId: organization.id },
    select: { pausedAt: true, pauseEndsAt: true, stripeSubscriptionId: true },
  });

  // THER-010: protect the canonical subscription row from last-writer-wins
  // clobbering. If we already track a DIFFERENT subscription for this org and
  // the incoming event is for a subscription that is not itself active/trialing
  // (e.g. a superseded duplicate being canceled after a plan swap), ignore it —
  // otherwise a stale duplicate would overwrite the current plan and make the
  // UI flip-flop / show "renews automatically" after a cancel. An incoming
  // active/trialing subscription is allowed through and becomes canonical.
  const incomingIsActive = sub.status === 'active' || sub.status === 'trialing';
  if (
    existing?.stripeSubscriptionId &&
    existing.stripeSubscriptionId !== sub.id &&
    !incomingIsActive
  ) {
    logger.warn({
      msg: '[Stripe Webhook] Ignoring non-active duplicate subscription to protect canonical row',
      organizationId: organization.id,
    });
    return;
  }

  // Reconcile the active Stripe discount (promo code applied at Checkout, or a
  // coupon applied directly in the dashboard). Recomputed on every upsert so a
  // removed/expired discount clears the persisted columns automatically.
  const discountFields = await extractDiscountFields(sub);

  const pausedAt = isPaused ? (existing?.pausedAt ?? new Date()) : null;
  // F-040: a pause originating from the Stripe portal has no pauseEndsAt of our
  // own. Leaving it null makes getPauseState() report 'paused' forever — the
  // resume/cancel prompt would never appear. Default a portal-originated pause
  // to the same MAX_PAUSE_MONTHS window our pause route uses, so the decision
  // prompt eventually surfaces.
  const pauseEndsAt =
    isPaused && pausedAt
      ? (existing?.pauseEndsAt ?? pauseEndDate(pausedAt, MAX_PAUSE_MONTHS))
      : null;
  const hasAuditorAccess = (sub.status === 'active' || sub.status === 'trialing') && !isPaused;

  // Upsert subscription record and grant/revoke auditor access atomically
  await Promise.all([
    prisma.subscription.upsert({
      where: { organizationId: organization.id },
      create: {
        organizationId: organization.id,
        stripeSubscriptionId: sub.id,
        stripePriceId,
        plan: planKey,
        billingCycle,
        status: sub.status as SubscriptionStatus,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        pausedAt,
        pauseEndsAt,
        ...discountFields,
      },
      update: {
        stripeSubscriptionId: sub.id,
        stripePriceId,
        plan: planKey,
        billingCycle,
        status: sub.status as SubscriptionStatus,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        pausedAt,
        pauseEndsAt,
        ...discountFields,
      },
    }),
    prisma.organization.update({
      where: { id: organization.id },
      data: { hasAuditorAccess },
    }),
  ]);

  logger.info({
    msg: `[Stripe Webhook] Organization ${organization.id} — subscription ${sub.id} status: ${sub.status}`,
    hasAuditorAccess,
  });

  if (discountFields.discountPercentOff !== null || discountFields.discountAmountOff !== null) {
    logger.info({
      msg: `[Stripe Webhook] Persisted discount for subscription ${sub.id}`,
      promoCode: discountFields.discountPromoCode,
      percentOff: discountFields.discountPercentOff,
      endsAt: discountFields.discountEndsAt,
    });
  }
}

async function handleInvoiceUpsert(inv: Stripe.Invoice, overrideStatus?: string) {
  const customerId = typeof inv.customer === 'string' ? inv.customer : (inv.customer?.id ?? '');
  if (!customerId) return;

  const organization = await prisma.organization.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  if (!organization) {
    logger.warn({ msg: `[Stripe Webhook] No organization found for customer: ${customerId}` });
    return;
  }

  // Generate a human-readable invoice number if Stripe doesn't provide one
  const invoiceNumber = inv.number ?? `TH-${inv.id.slice(-6).toUpperCase()}`;
  const status = overrideStatus ?? inv.status ?? 'open';

  // Invoice-level period_start/period_end reflect invoice assembly time and are
  // (near-)equal for subscription renewals; the real service window lives on the
  // line items. Derive it, and write it in BOTH branches so a webhook replay /
  // Stripe "resend event" self-heals rows persisted before this fix.
  const { periodStart, periodEnd } = deriveInvoiceServicePeriod(inv);

  await prisma.invoice.upsert({
    where: { stripeInvoiceId: inv.id },
    create: {
      organizationId: organization.id,
      stripeInvoiceId: inv.id,
      invoiceNumber,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      status,
      invoiceUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
      periodStart,
      periodEnd,
    },
    update: {
      amountPaid: inv.amount_paid,
      status,
      invoiceUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
      periodStart,
      periodEnd,
    },
  });
}

async function handleAuditorAccessRevoke(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const organization = await prisma.organization.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  if (!organization) {
    logger.warn({ msg: `[Stripe Webhook] No organization found for customer: ${customerId}` });
    return;
  }

  await prisma.organization.update({
    where: { id: organization.id },
    data: { hasAuditorAccess: false },
  });

  logger.info({
    msg: `[Stripe Webhook] Organization ${organization.id} — auditor access revoked (subscription deleted)`,
  });
}
