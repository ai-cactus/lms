import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import stripe from '@/lib/stripe';

// POST /api/billing/payment-methods/[id]/default — set a payment method as the default
export async function POST(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params;

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

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId ?? '' },
      select: { stripeCustomerId: true },
    });

    if (!organization?.stripeCustomerId) {
      return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 });
    }

    // Verify ownership before setting default
    const pm = await stripe.paymentMethods.retrieve(id);
    if (pm.customer !== organization.stripeCustomerId) {
      return NextResponse.json({ error: 'Payment method not found' }, { status: 404 });
    }

    await stripe.customers.update(organization.stripeCustomerId, {
      invoice_settings: { default_payment_method: id },
    });

    return NextResponse.json({ success: true, message: 'Default payment method updated.' });
  } catch (error) {
    console.error('[POST /api/billing/payment-methods/[id]/default]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
