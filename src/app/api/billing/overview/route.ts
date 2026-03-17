import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import stripe from '@/lib/stripe';

// GET /api/billing/overview — returns current plan, staff usage, payment method, last 2 invoices
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
      select: {
        name: true,
        staffCount: true,
        address: true,
        city: true,
        state: true,
        country: true,
        stripeCustomerId: true,
        subscription: true,
      },
    });

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Count active staff members
    const activeStaffCount = await prisma.user.count({
      where: {
        organizationId: user.organizationId,
        role: 'worker',
      },
    });

    // Fetch payment method from Stripe if customer exists
    let defaultPaymentMethod = null;
    if (organization.stripeCustomerId) {
      const customer = await stripe.customers.retrieve(organization.stripeCustomerId, {
        expand: ['invoice_settings.default_payment_method'],
      });

      if (!customer.deleted && customer.invoice_settings?.default_payment_method) {
        const pm = customer.invoice_settings.default_payment_method;
        if (typeof pm !== 'string' && pm.card) {
          defaultPaymentMethod = {
            id: pm.id,
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
            billingAddress: {
              name: pm.billing_details?.name,
              line1: pm.billing_details?.address?.line1,
              city: pm.billing_details?.address?.city,
              state: pm.billing_details?.address?.state,
              country: pm.billing_details?.address?.country,
            },
          };
        }
      }
    }

    // Recent invoices (last 2)
    const recentInvoices = await prisma.invoice.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });

    return NextResponse.json({
      organization: {
        name: organization.name,
        staffCount: organization.staffCount,
      },
      subscription: organization.subscription,
      activeStaffCount,
      defaultPaymentMethod,
      recentInvoices: recentInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amountPaid: inv.amountPaid,
        currency: inv.currency,
        status: inv.status,
        invoiceUrl: inv.invoiceUrl,
        pdfUrl: inv.pdfUrl,
        createdAt: inv.createdAt,
      })),
    });
  } catch (error) {
    console.error('[GET /api/billing/overview]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
