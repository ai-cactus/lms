import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorize } from '@/lib/rbac/authorize';
import { resolveDataFacilityIds } from '@/lib/facility/staff-where';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;

    // D-01: this route previously performed NO role check at all — any
    // authenticated session could poll any job in its organization.
    const authResult = await authorize('auditPack.read');
    if (!authResult.ok) return authResult.response;
    const { userId, organizationId } = authResult.ctx;

    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Ensure they only poll their own org's jobs (though job IDs are UUIDs)
    if (job.userId !== userId) {
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

      // Tenant isolation is not facility isolation. Same-org membership alone
      // let one facility's supervisor poll another's export and watch it
      // progress — no report content, but the existence, timing and completion
      // of another site's audit run is itself scoped information.
      //
      // Mirrors the download route's rule so the two cannot drift: a
      // facility-bound caller may only see a job whose recorded scope their own
      // contains. `undefined` (a job predating that field) is treated as
      // unknown, not as org-wide, and refused.
      const callerFacilityIds = await resolveDataFacilityIds({
        user: {
          id: userId,
          role: authResult.ctx.role,
          organizationId,
          organizationUserId: authResult.ctx.organizationUserId,
        },
      });
      if (callerFacilityIds !== null) {
        const jobFacilityIds = (job.payload as Record<string, unknown> | null)?.facilityIds as
          string[] | null | undefined;
        const visible =
          Array.isArray(jobFacilityIds) &&
          jobFacilityIds.every((id) => callerFacilityIds.includes(id));
        if (!visible) {
          logger.warn({
            msg: '[auditor] Status refused — job scope exceeds caller scope',
            userId,
            jobId,
          });
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
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
