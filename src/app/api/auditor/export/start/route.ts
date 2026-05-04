import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { auditorExportQueue } from '@/lib/queue/auditor-export-queue';
import { getExportWorker } from '@/lib/queue/auditor-export-worker';
import { logger } from '@/lib/logger';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true, role: true },
    });

    if (!user || user.role !== 'admin' || !user.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const dbJob = await prisma.job.create({
      data: {
        type: 'AUDITOR_PACK_EXPORT',
        userId: session.user.id,
        status: 'queued',
        payload: { progress: 0, message: 'Queued for export...' },
      },
    });

    // Enforce worker initialization in development / monolithic deploys
    getExportWorker();

    await auditorExportQueue.add('export-org-data', {
      organizationId: user.organizationId,
      dbJobId: dbJob.id,
    });

    return NextResponse.json({ jobId: dbJob.id });
  } catch (error) {
    logger.error({ msg: 'Failed to start export:', err: error });
    return NextResponse.json({ error: 'Failed to start export' }, { status: 500 });
  }
}
