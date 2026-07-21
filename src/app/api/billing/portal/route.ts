import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { getStripeClient } from '@/lib/stripe';
import { logger } from '@/lib/logger';

// POST /api/billing/portal — creates a Stripe Billing Portal session and returns the redirect URL.
// The portal lets customers add/update/remove payment methods and view invoices on a
// Stripe-hosted page, so we never need to build custom card-input UI.
export async function POST(request: NextRequest) {
  try {
    const authResult = await authorize('billing.edit');
    if (!authResult.ok) return authResult.response;
    const { ctx } = authResult;

    if (!ctx.organizationId) {
      return apiError('No organization found', 404);
    }
    const organizationId = ctx.organizationId;

    const stripe = getStripeClient();

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true, name: true, primaryEmail: true },
    });

    let customerId = organization?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: organization?.name ?? undefined,
        email: organization?.primaryEmail ?? undefined,
        metadata: { organizationId },
      });
      customerId = customer.id;
      await prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    let returnUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/dashboard/billing?tab=payment-method`;
    try {
      const body = (await request.json()) as { returnUrl?: string };
      if (body.returnUrl) returnUrl = body.returnUrl;
    } catch {
      // body is optional — use default return URL
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/portal]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
