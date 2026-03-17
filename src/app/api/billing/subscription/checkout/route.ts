import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import stripe from '@/lib/stripe';
import { BILLING_PLANS, BillingCycle } from '@/lib/billing-plans';

// POST /api/billing/subscription/checkout — creates or updates a Stripe Checkout session
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, organizationId: true },
    });

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!user.organizationId) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 });
    }

    const body = (await request.json()) as { planKey: string; billingCycle: BillingCycle };
    const { planKey, billingCycle } = body;

    if (!planKey || !billingCycle) {
      return NextResponse.json({ error: 'Missing planKey or billingCycle' }, { status: 400 });
    }

    const plan = BILLING_PLANS.find((p) => p.key === planKey);
    if (!plan || plan.isEnterprise) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    const priceId = plan.priceId[billingCycle];
    if (!priceId) {
      return NextResponse.json(
        { error: `No price configured for ${planKey} / ${billingCycle}` },
        { status: 422 },
      );
    }

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: {
        name: true,
        primaryEmail: true,
        stripeCustomerId: true,
        staffCount: true,
      },
    });

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Enforce plan restriction: orgs with more staff cannot downgrade
    const orgStaffNum = parseInt(organization.staffCount ?? '0', 10);
    if (plan.staffMax !== null && orgStaffNum > plan.staffMax) {
      return NextResponse.json(
        { error: 'Your organization has too many staff members for this plan.' },
        { status: 422 },
      );
    }

    // Resolve or create Stripe customer
    let customerId = organization.stripeCustomerId ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: organization.name,
        email: organization.primaryEmail ?? undefined,
        metadata: { organizationId: user.organizationId },
      });
      customerId = customer.id;
      await prisma.organization.update({
        where: { id: user.organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard/billing?tab=overview&checkout=success`,
      cancel_url: `${appUrl}/dashboard/billing?tab=subscription`,
      metadata: {
        organizationId: user.organizationId,
        planKey,
        billingCycle,
      },
      subscription_data: {
        metadata: {
          organizationId: user.organizationId,
          planKey,
          billingCycle,
        },
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error('[POST /api/billing/subscription/checkout]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
