import { NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { logger } from '@/lib/logger';

// GET /api/billing/payment-methods — list all payment methods attached to the org's Stripe customer
// Force dynamic rendering to prevent Next.js from caching this response
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const authResult = await authorize('billing.read');
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
      return NextResponse.json({ paymentMethods: [], defaultPaymentMethodId: null });
    }

    const customer = await stripe.customers.retrieve(organization.stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    });

    if (customer.deleted) {
      return NextResponse.json({ paymentMethods: [], defaultPaymentMethodId: null });
    }

    const defaultPm = customer.invoice_settings?.default_payment_method;
    const defaultPaymentMethodId =
      typeof defaultPm === 'string' ? defaultPm : (defaultPm?.id ?? null);

    const pmList = await stripe.paymentMethods.list({
      customer: organization.stripeCustomerId,
      type: 'card',
    });

    const paymentMethods = pmList.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'unknown',
      last4: pm.card?.last4 ?? '****',
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
      billingDetails: {
        name: pm.billing_details?.name,
        email: pm.billing_details?.email,
        address: pm.billing_details?.address,
      },
      isDefault: pm.id === defaultPaymentMethodId,
    }));

    return NextResponse.json(
      { paymentMethods, defaultPaymentMethodId },
      {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      },
    );
  } catch (error) {
    logger.error({ msg: '[GET /api/billing/payment-methods]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
