import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Ensure they only poll their own org's jobs (though job IDs are UUIDs)
    if (job.userId !== session.user.id) {
      const { organizationId } = session.user;
      const jobOwnerMembership =
        organizationId && job.userId
          ? await prisma.organizationUser.findFirst({
              where: { userId: job.userId, organizationId },
              select: { id: true },
            })
          : null;
      if (!jobOwnerMembership) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const payloadObj =
      typeof job.payload === 'object' && job.payload !== null
        ? (job.payload as Record<string, unknown>)
        : {};
    const progress = (payloadObj.progress as number) ?? (job.status === 'completed' ? 100 : 0);
    const message = (payloadObj.message as string) ?? 'Processing...';

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      progress,
      message,
    });
  } catch (error) {
    logger.error({ msg: 'Failed to get job status:', err: error });
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
