import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { downloadFile } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { captureServer } from '@/lib/analytics/server';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { resolveDataFacilityIds, staffFacilityWhere } from '@/lib/facility/staff-where';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const [adminSession, workerSession] = await Promise.all([adminAuth(), workerAuth()]);

    if (!adminSession?.user?.id && !workerSession?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const certificate = await prisma.certificate.findUnique({
      where: { id: params.id },
      include: {
        organizationUser: { select: { organizationId: true } },
        // Selected alongside the authorization lookup rather than queried again:
        // the download path should not cost an extra round trip to be measurable.
        enrollment: { select: { courseId: true } },
      },
    });

    if (!certificate) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
    }

    // Self-access, on whichever instance the holder is signed in to. Resolved
    // before the administrative branch for the same reason as
    // `getCertificateDetails`: a holder with no active facility assignment
    // narrows to `[]` and would otherwise be refused their own certificate.
    const isWorker = workerSession?.user?.organizationUserId === certificate.organizationUserId;
    const isSelf =
      isWorker || adminSession?.user?.organizationUserId === certificate.organizationUserId;

    // The session this download is attributed to.
    const actor = isWorker ? workerSession?.user : (adminSession?.user ?? workerSession?.user);

    let authorized = isSelf;

    // The administrative branch checked org equality and NOTHING else — not even
    // `isAdminRole` — so every admin-tier session in the organisation could pull
    // any holder's PDF by id. Same gate as `getCertificateDetails`: the verb,
    // then the facility narrowing, both composed into the query.
    if (!authorized && adminSession?.user?.id && adminSession.user.organizationId) {
      const roleKey = dbRoleToRoleKey(adminSession.user.role);
      if (roleKey && can(roleKey, 'certificate.read')) {
        const dataFacilityIds = await resolveDataFacilityIds(adminSession);
        const inScope = await prisma.certificate.findFirst({
          where: {
            id: params.id,
            organizationUser: {
              organizationId: adminSession.user.organizationId,
              ...staffFacilityWhere(dataFacilityIds),
            },
          },
          select: { id: true },
        });
        authorized = Boolean(inScope);
      }
    }

    if (!authorized) {
      logger.warn({
        msg: '[certificate] Certificate download denied',
        userId: actor?.id,
        role: actor?.role,
        certificateId: params.id,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!certificate.pdfStoragePath) {
      return NextResponse.json({ error: 'Certificate file not generated' }, { status: 404 });
    }

    const fileBuffer = await downloadFile(certificate.pdfStoragePath);

    // F-001: record certificate (PHI-adjacent) download on the authorized path.
    await audit({
      action: 'certificate.download',
      actorId: actor?.id,
      // The DB role, not the auth instance. Every other `audit()` call records
      // the real role, and 'admin'/'worker' here named the cookie the request
      // arrived on — which cannot answer "who read this certificate".
      actorRole: actor?.role,
      organizationId: certificate.organizationUser.organizationId,
      targetType: 'certificate',
      targetId: params.id,
      ...getClientContext(request.headers),
    });

    // Beside the existing audit row, which already establishes this as the one
    // authorized download path. Attributed to whichever session passed the
    // check above — a learner fetching their own, or an admin fetching theirs.
    captureServer(
      'certificate_downloaded',
      { course_id: certificate.enrollment?.courseId ?? '', format: 'pdf' },
      {
        distinctId: actor?.id ?? '',
        organizationId: certificate.organizationUser.organizationId,
      },
    );

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="certificate-${params.id}.pdf"`,
      },
    });
  } catch (error) {
    logger.error({ msg: 'Error fetching certificate:', err: error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
