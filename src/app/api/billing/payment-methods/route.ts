import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import stripe from '@/lib/stripe';

// GET /api/billing/payment-methods — list all payment methods attached to the org's Stripe customer
export async function GET() {
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

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
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

    return NextResponse.json({ paymentMethods, defaultPaymentMethodId });
  } catch (error) {
    console.error('[GET /api/billing/payment-methods]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
