import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import stripe from '@/lib/stripe';

// POST /api/billing/portal — creates a Stripe Billing Portal session and returns the redirect URL.
// The portal lets customers add/update/remove payment methods and view invoices on a
// Stripe-hosted page, so we never need to build custom card-input UI.
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

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { stripeCustomerId: true, name: true, primaryEmail: true },
    });

    // If the org doesn't have a Stripe customer yet, create one first
    let customerId = organization?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: organization?.name ?? undefined,
        email: organization?.primaryEmail ?? undefined,
        metadata: { organizationId: user.organizationId },
      });
      customerId = customer.id;
      await prisma.organization.update({
        where: { id: user.organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    // Read return URL from the request body (defaults to billing page)
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
    console.error('[POST /api/billing/portal]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
