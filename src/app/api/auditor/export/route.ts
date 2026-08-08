import { NextResponse } from 'next/server';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { generateAuditorPackCsv } from '@/app/actions/auditor';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { role, organizationId } = session.user;
    if (!isAdminRole(role) || !organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check billing gate
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { hasAuditorAccess: true, name: true },
    });

    if (!org?.hasAuditorAccess) {
      return NextResponse.json(
        { error: 'Auditor Pack access requires a billing plan.' },
        { status: 402 },
      );
    }

    const csv = await generateAuditorPackCsv();
    const fileName = `auditor-pack-${org.name.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;

    logger.info({
      msg: '[auditor] CSV export generated',
      data: { organizationId },
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error({ msg: '[auditor] export failed', err: { error } });
    return NextResponse.json({ error: 'Export failed. Please try again.' }, { status: 500 });
  }
}
