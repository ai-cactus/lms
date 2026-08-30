import { NextResponse, NextRequest } from 'next/server';
import { authorize } from '@/lib/rbac/authorize';
import { resolveAuditFacilityIds } from '@/lib/audit-reports/scope';
import { orgCourseWhere } from '@/lib/course/org-scope';
import prisma from '@/lib/prisma';
import { auditorExportQueue } from '@/lib/queue/auditor-export-queue';
import { getExportWorker } from '@/lib/queue/auditor-export-worker';
import { logger } from '@/lib/logger';
import { resolveDateRange } from '@/lib/audit-reports/date-range';

type Scope = 'org' | 'course' | 'staff' | 'all-courses' | 'all-staff';

export async function POST(req: NextRequest) {
  try {
    // D-01: starting an export job produces org-wide bulk data. `isAdminRole`
    // admitted Finance and Clinical Director; `auditPack.create` does not.
    const authResult = await authorize('auditPack.create');
    if (!authResult.ok) return authResult.response;

    const { organizationId, userId } = authResult.ctx;
    if (!organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // D-01: the facility scope is derived from the SESSION here and stamped
    // into the job, never read from the request body — a caller must not be
    // able to widen their own export. `null` = org-wide, which is what the
    // audit surface deliberately gives a supervisor so the export cannot
    // disagree with the screen it was launched from.
    const facilityIds = await resolveAuditFacilityIds({
      user: {
        id: userId,
        role: authResult.ctx.role,
        organizationId,
        organizationUserId: authResult.ctx.organizationUserId,
      },
    });
    if (facilityIds !== null && facilityIds.length === 0) {
      // Fail closed: a facility-bound caller with no assignments would otherwise
      // queue a job whose subject set is empty and whose meaning is unclear.
      return NextResponse.json({ error: 'No facility assigned' }, { status: 403 });
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
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
      // Deliberately NOT facility-narrowed. Per team finding #17 the course
      // catalogue is an org-level artifact — a supervisor may report on any of
      // the org's courses; it is the enrollment DATA inside that is limited.
      if (!scopeId) return NextResponse.json({ error: 'scopeId required' }, { status: 400 });
      const course = await prisma.course.findFirst({
        // Adopted (platform-catalogue) courses are authored by another tenant,
        // so a creator-only predicate 404s every video course the org offers.
        where: { id: scopeId, ...(await orgCourseWhere(organizationId)) },
        select: { id: true },
      });
      if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    } else if (scope === 'staff') {
      if (!scopeId) return NextResponse.json({ error: 'scopeId required' }, { status: 400 });
      // scopeId is the OrganizationUser id — see auditor-export-worker.ts.
      // Facility-narrowed so an out-of-scope target 404s here rather than
      // queueing a job that silently produces an empty report.
      const staff = await prisma.organizationUser.findFirst({
        where: {
          id: scopeId,
          organizationId,
          ...(facilityIds
            ? { facilities: { some: { facilityId: { in: facilityIds }, active: true } } }
            : {}),
        },
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
        userId,
        status: 'queued',
        payload: {
          progress: 0,
          message: 'Queued for export...',
          scope,
          scopeId: scopeId ?? null,
          label,
          from,
          to,
          facilityIds,
        },
      },
    });

    // Enforce worker initialization in development / monolithic deploys
    getExportWorker();

    await auditorExportQueue.add('export-org-data', {
      organizationId,
      dbJobId: dbJob.id,
      scope,
      scopeId,
      from,
      to,
      facilityIds,
    });

    return NextResponse.json({ jobId: dbJob.id, scope, label });
  } catch (error) {
    logger.error({ msg: 'Failed to start export:', err: error });
    return NextResponse.json({ error: 'Failed to start export' }, { status: 500 });
  }
}
