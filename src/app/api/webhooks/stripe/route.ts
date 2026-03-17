import { NextRequest, NextResponse } from 'next/server';
import stripe from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import Stripe from 'stripe';

// Stripe webhook secret — required to verify event authenticity
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Stripe Webhook] Signature verification failed: ${message}`);
    return NextResponse.json({ error: `Webhook error: ${message}` }, { status: 400 });
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
  } catch (error) {
    console.error(`[Stripe Webhook] Error handling event ${event.type}:`, error);
    // Return 200 to prevent Stripe retrying non-recoverable errors
    return NextResponse.json({ received: true, error: 'Event processing failed' });
  }

  return NextResponse.json({ received: true });
}

async function handleSubscriptionUpsert(sub: Stripe.Subscription) {
  // Resolve the organization from the Stripe customer ID
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const organization = await prisma.organization.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  if (!organization) {
    console.warn(`[Stripe Webhook] No organization found for customer: ${customerId}`);
    return;
  }

  const planKey = (sub.metadata?.planKey as string) ?? 'starter';
  const billingCycle = (sub.metadata?.billingCycle as string) ?? 'monthly';
  const priceItem = sub.items.data[0];
  const stripePriceId = priceItem?.price.id ?? '';

  // In Stripe SDK 2026, current_period_start/end moved from Subscription to SubscriptionItem
  const periodStart = priceItem?.current_period_start ?? sub.billing_cycle_anchor;
  const periodEnd = priceItem?.current_period_end ?? sub.billing_cycle_anchor;

  await prisma.subscription.upsert({
    where: { organizationId: organization.id },
    create: {
      organizationId: organization.id,
      stripeSubscriptionId: sub.id,
      stripePriceId,
      plan: planKey,
      billingCycle,
      status: sub.status,
      currentPeriodStart: new Date(periodStart * 1000),
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
    update: {
      stripeSubscriptionId: sub.id,
      stripePriceId,
      plan: planKey,
      billingCycle,
      status: sub.status,
      currentPeriodStart: new Date(periodStart * 1000),
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });
}

async function handleInvoiceUpsert(inv: Stripe.Invoice, overrideStatus?: string) {
  const customerId = typeof inv.customer === 'string' ? inv.customer : (inv.customer?.id ?? '');
  if (!customerId) return;

  const organization = await prisma.organization.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  if (!organization) {
    console.warn(`[Stripe Webhook] No organization found for customer: ${customerId}`);
    return;
  }

  // Generate a human-readable invoice number if Stripe doesn't provide one
  const invoiceNumber = inv.number ?? `TH-${inv.id.slice(-6).toUpperCase()}`;
  const status = overrideStatus ?? inv.status ?? 'open';

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
      periodStart: new Date((inv.period_start ?? 0) * 1000),
      periodEnd: new Date((inv.period_end ?? 0) * 1000),
    },
    update: {
      amountPaid: inv.amount_paid,
      status,
      invoiceUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
    },
  });
}
