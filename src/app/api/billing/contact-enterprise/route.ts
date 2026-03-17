import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { sendEnterpriseInquiryEmail } from '@/lib/email';

// POST /api/billing/contact-enterprise — sends enterprise inquiry to sales team
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, organizationId: true, email: true },
    });

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as {
      contactName: string;
      message: string;
    };

    const { contactName, message } = body;

    if (!contactName?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'contactName and message are required.' }, { status: 400 });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId ?? '' },
      select: { name: true, primaryEmail: true, staffCount: true },
    });

    const enterpriseEmail = process.env.ENTERPRISE_CONTACT_EMAIL ?? 'admin@theraptly.com';

    await sendEnterpriseInquiryEmail({
      to: enterpriseEmail,
      contactName,
      orgName: organization?.name ?? 'Unknown Organization',
      contactEmail: user.email,
      staffCount: organization?.staffCount ?? 'Unknown',
      message,
    });

    return NextResponse.json({
      success: true,
      message:
        'Your inquiry has been sent. The Theraptly team will reach out to your organization to discuss your needs.',
    });
  } catch (error) {
    console.error('[POST /api/billing/contact-enterprise]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
