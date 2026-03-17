import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { generateAuditorPackCsv } from '@/app/actions/auditor';

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

    if (!user || user.role !== 'admin' || !user.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check billing gate
    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
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

    console.info('[auditor] CSV export generated', { organizationId: user.organizationId });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[auditor] export failed', { error });
    return NextResponse.json({ error: 'Export failed. Please try again.' }, { status: 500 });
  }
}
