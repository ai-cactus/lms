import { NextResponse, NextRequest } from 'next/server';
import { isAdminRole } from '@/lib/rbac/role-utils';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { auditorExportQueue } from '@/lib/queue/auditor-export-queue';
import { getExportWorker } from '@/lib/queue/auditor-export-worker';
import { logger } from '@/lib/logger';
import { resolveDateRange } from '@/lib/audit-reports/date-range';

type Scope = 'org' | 'course' | 'staff' | 'all-courses' | 'all-staff';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { organizationId: true, role: true },
    });
    if (!user || !isAdminRole(user.role) || !user.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { hasAuditorAccess: true },
    });
    if (!org?.hasAuditorAccess) {
      return NextResponse.json({ error: 'Auditor access not enabled' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      scope?: Scope;
      scopeId?: string;
      label?: string;
      from?: string;
      to?: string;
    };
    const scope: Scope = body.scope ?? 'org';
    const scopeId = body.scopeId;

    // Validate the optional date range up front (from <= to, parseable). An
    // empty range is allowed and means "no filter".
    try {
      resolveDateRange({ from: body.from, to: body.to });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid date range' },
        { status: 400 },
      );
    }
    const from = body.from || null;
    const to = body.to || null;

    // ── Authorize scopeId belongs to this org ──
    if (scope === 'course') {
      if (!scopeId) return NextResponse.json({ error: 'scopeId required' }, { status: 400 });
      const orgUserIds = await prisma.user
        .findMany({ where: { organizationId: user.organizationId }, select: { id: true } })
        .then((u) => u.map((x) => x.id));
      const course = await prisma.course.findFirst({
        where: { id: scopeId, createdBy: { in: orgUserIds } },
        select: { id: true },
      });
      if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    } else if (scope === 'staff') {
      if (!scopeId) return NextResponse.json({ error: 'scopeId required' }, { status: 400 });
      const staff = await prisma.user.findFirst({
        where: { id: scopeId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
    }

    const label =
      body.label ??
      (scope === 'course'
        ? 'Course report'
        : scope === 'staff'
          ? 'Staff report'
          : scope === 'all-courses'
            ? 'All courses report'
            : scope === 'all-staff'
              ? 'All staff report'
              : 'Organization report');

    const dbJob = await prisma.job.create({
      data: {
        type: 'AUDITOR_PACK_EXPORT',
        userId: session.user.id,
        status: 'queued',
        payload: {
          progress: 0,
          message: 'Queued for export...',
          scope,
          scopeId: scopeId ?? null,
          label,
          from,
          to,
        },
      },
    });

    // Enforce worker initialization in development / monolithic deploys
    getExportWorker();

    await auditorExportQueue.add('export-org-data', {
      organizationId: user.organizationId,
      dbJobId: dbJob.id,
      scope,
      scopeId,
      from,
      to,
    });

    return NextResponse.json({ jobId: dbJob.id, scope, label });
  } catch (error) {
    logger.error({ msg: 'Failed to start export:', err: error });
    return NextResponse.json({ error: 'Failed to start export' }, { status: 500 });
  }
}
