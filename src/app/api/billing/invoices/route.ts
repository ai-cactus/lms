import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { authorize } from '@/lib/rbac/authorize';
import { apiError } from '@/lib/api-response';

// GET /api/billing/invoices?page=1 — returns paginated invoice list
export async function GET(request: NextRequest) {
  try {
    const authResult = await authorize('billing.read');
    if (!authResult.ok) return authResult.response;
    const { ctx } = authResult;

    if (!ctx.organizationId) {
      return apiError('No organization found', 404);
    }
    const organizationId = ctx.organizationId;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.invoice.count({
        where: { organizationId },
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
    logger.error({ msg: '[GET /api/billing/invoices]', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
