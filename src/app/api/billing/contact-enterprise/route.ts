import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { sendEnterpriseInquiryEmail } from '@/lib/email';
import { logger } from '@/lib/logger';

// ── Request body shape ────────────────────────────────────────────────────────

interface EnterpriseInquiryBody {
  firstName?: string;
  lastName?: string;
  /** Required */
  workEmail: string;
  jobTitle?: string;
  /** Required */
  organizationName: string;
  facilityType?: string;
  numberOfFacilities?: string;
  numberOfStaff?: string;
  currentAccreditation?: string;
  currentTrainingMethod?: string;
  primaryPainPoint?: string;
}

// Basic email format guard
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Route handler ─────────────────────────────────────────────────────────────

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

    // Parse and validate body
    let body: EnterpriseInquiryBody;
    try {
      body = (await request.json()) as EnterpriseInquiryBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const {
      firstName,
      lastName,
      workEmail,
      jobTitle,
      organizationName,
      facilityType,
      numberOfFacilities,
      numberOfStaff,
      currentAccreditation,
      currentTrainingMethod,
      primaryPainPoint,
    } = body;

    // Required field validation
    if (!firstName?.trim()) {
      return NextResponse.json({ error: 'First name is required.' }, { status: 400 });
    }
    if (!lastName?.trim()) {
      return NextResponse.json({ error: 'Last name is required.' }, { status: 400 });
    }
    if (!workEmail?.trim()) {
      return NextResponse.json({ error: 'Work email is required.' }, { status: 400 });
    }
    if (!isValidEmail(workEmail.trim())) {
      return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 });
    }
    if (!jobTitle?.trim()) {
      return NextResponse.json({ error: 'Job title is required.' }, { status: 400 });
    }
    if (!organizationName?.trim()) {
      return NextResponse.json({ error: 'Organization name is required.' }, { status: 400 });
    }
    if (!facilityType?.trim()) {
      return NextResponse.json({ error: 'Facility type is required.' }, { status: 400 });
    }
    if (!numberOfFacilities?.trim()) {
      return NextResponse.json({ error: 'Number of facilities is required.' }, { status: 400 });
    }
    if (!numberOfStaff?.trim()) {
      return NextResponse.json({ error: 'Number of staff is required.' }, { status: 400 });
    }
    if (!currentAccreditation?.trim()) {
      return NextResponse.json({ error: 'Accreditation is required.' }, { status: 400 });
    }
    if (!currentTrainingMethod?.trim()) {
      return NextResponse.json({ error: 'Training method is required.' }, { status: 400 });
    }
    if (!primaryPainPoint?.trim()) {
      return NextResponse.json({ error: 'Primary pain point is required.' }, { status: 400 });
    }

    // Fetch organization for additional context
    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId ?? '' },
      select: { name: true, primaryEmail: true, staffCount: true },
    });

    const enterpriseEmail = process.env.ENTERPRISE_CONTACT_EMAIL ?? 'admin@theraptly.com';

    await sendEnterpriseInquiryEmail({
      to: enterpriseEmail,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      workEmail: workEmail.trim(),
      jobTitle: jobTitle.trim(),
      organizationName: organizationName.trim(),
      facilityType: facilityType.trim(),
      numberOfFacilities: numberOfFacilities.trim(),
      numberOfStaff: numberOfStaff.trim(),
      currentAccreditation: currentAccreditation.trim(),
      currentTrainingMethod: currentTrainingMethod.trim(),
      primaryPainPoint: primaryPainPoint.trim(),
      // Authenticated user context (for reply-to)
      authUserEmail: user.email,
      orgName: organization?.name ?? 'Unknown Organization',
    });

    logger.info({
      msg: '[enterprise-inquiry] Inquiry submitted successfully',
      orgName: organizationName,
      workEmail,
    });

    return NextResponse.json({
      success: true,
      message:
        'Your inquiry has been sent. The Theraptly team will reach out to discuss your needs.',
    });
  } catch (error) {
    logger.error({ msg: '[POST /api/billing/contact-enterprise] Unexpected error', error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
