import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { logger } from '@/lib/logger';

// DELETE /api/billing/payment-methods/[id] — detach a saved payment method
export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params;

    const authResult = await authorize('billing.delete');
    if (!authResult.ok) return authResult.response;
    const { ctx } = authResult;

    if (!ctx.organizationId) {
      return apiError('No organization found', 404);
    }

    const stripe = getStripeClient();

    const organization = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
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
    logger.error({ msg: '[DELETE /api/billing/payment-methods/[id]]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
