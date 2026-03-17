import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

// GET /api/billing/invoices?page=1 — returns paginated invoice list
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.invoice.count({
        where: { organizationId: user.organizationId },
      }),
    ]);

    return NextResponse.json({
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amountPaid: inv.amountPaid,
        currency: inv.currency,
        status: inv.status,
        invoiceUrl: inv.invoiceUrl,
        pdfUrl: inv.pdfUrl,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        createdAt: inv.createdAt,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('[GET /api/billing/invoices]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
