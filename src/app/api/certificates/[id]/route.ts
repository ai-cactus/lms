import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { downloadFile } from '@/lib/storage';
import { logger } from '@/lib/logger';
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
        user: { select: { organizationId: true } },
      },
    });

    if (!certificate) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
    }

    // Verify access
    const isWorker = workerSession?.user?.id === certificate.userId;
    const isAdmin =
      adminSession?.user?.id &&
      adminSession.user.organizationId === certificate.user.organizationId;

    if (!isWorker && !isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Stream the file directly
    if (!certificate.pdfStoragePath) {
      return NextResponse.json({ error: 'Certificate file not generated' }, { status: 404 });
    }

    const fileBuffer = await downloadFile(certificate.pdfStoragePath);
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
