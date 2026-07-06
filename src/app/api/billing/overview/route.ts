import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import stripe from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';

// GET /api/billing/overview — returns current plan, staff usage, payment method, last 2 invoices
export async function GET() {
  try {
    const authResult = await authorize('billing.read');
    if (!authResult.ok) return authResult.response;
    const { ctx } = authResult;

    if (!ctx.organizationId) {
      return apiError('No organization found', 404);
    }
    const organizationId = ctx.organizationId;

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        facilities: { select: { staffCount: true }, take: 1 },
        stripeCustomerId: true,
        subscription: true,
      },
    });

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const activeStaffCount = await prisma.user.count({
      where: {
        organizationId,
        role: 'worker',
      },
    });

    let defaultPaymentMethod = null;
    if (organization.stripeCustomerId) {
      const customer = await stripe.customers.retrieve(organization.stripeCustomerId, {
        expand: ['invoice_settings.default_payment_method'],
      });

      const rawDefaultPm = !customer.deleted
        ? customer.invoice_settings?.default_payment_method
        : null;
      const defaultPm = rawDefaultPm && typeof rawDefaultPm !== 'string' ? rawDefaultPm : null;
      const defaultPmId = typeof rawDefaultPm === 'string' ? rawDefaultPm : (defaultPm?.id ?? null);

      if (defaultPm?.card) {
        defaultPaymentMethod = {
          id: defaultPm.id,
          brand: defaultPm.card.brand,
          last4: defaultPm.card.last4,
          expMonth: defaultPm.card.exp_month,
          expYear: defaultPm.card.exp_year,
          billingAddress: {
            name: defaultPm.billing_details?.name,
            line1: defaultPm.billing_details?.address?.line1,
            city: defaultPm.billing_details?.address?.city,
            state: defaultPm.billing_details?.address?.state,
            country: defaultPm.billing_details?.address?.country,
          },
        };
      } else if (!customer.deleted) {
        // Fallback: list attached payment methods and pick the default or first one
        const pmList = await stripe.paymentMethods.list({
          customer: organization.stripeCustomerId,
          type: 'card',
        });
        if (pmList.data.length > 0) {
          const pm = defaultPmId
            ? (pmList.data.find((p) => p.id === defaultPmId) ?? pmList.data[0])
            : pmList.data[0];
          if (pm.card) {
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
    }

    const recentInvoices = await prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });

    return NextResponse.json({
      organization: {
        name: organization.name,
        staffCount: organization.facilities[0]?.staffCount ?? null,
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
    logger.error({ msg: '[GET /api/billing/overview]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
