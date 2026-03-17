import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import stripe from '@/lib/stripe';

// DELETE /api/billing/payment-methods/[id] — detach a saved payment method
export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
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

    // Verify this payment method belongs to the org's customer before detaching
    const pm = await stripe.paymentMethods.retrieve(id);
    if (pm.customer !== organization.stripeCustomerId) {
      return NextResponse.json({ error: 'Payment method not found' }, { status: 404 });
    }

    await stripe.paymentMethods.detach(id);

    return NextResponse.json({ success: true, message: 'Payment method removed.' });
  } catch (error) {
    console.error('[DELETE /api/billing/payment-methods/[id]]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
