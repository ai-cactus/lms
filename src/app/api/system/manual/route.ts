import { NextRequest, NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/storage';
import { indexStandardManual } from '@/lib/manual-indexer';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  // Authenticate before consuming the multipart body. If we return early before
  // reading formData(), Next.js can emit a "Content-Length header exceeds body"
  // warning — but we still return the proper JSON error payload.
  const isAuth = await verifySystemAdminCookie();
  if (!isAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const version = formData.get('version');

    // Validate types strictly
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing or invalid file field' }, { status: 400 });
    }
    if (typeof version !== 'string' || !version.trim()) {
      return NextResponse.json({ error: 'Missing or invalid version field' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
    }

    if (file.size > 50 * 1024 * 1024) {
      // 50 MB hard cap — prevents OOM during buffer conversion
      return NextResponse.json(
        { error: 'File exceeds maximum allowed size of 50 MB' },
        { status: 413 },
      );
    }

    logger.info({
      msg: '[ManualUpload] Processing upload',
      filename: file.name,
      version: version.trim(),
      sizeBytes: file.size,
    });

    // 1. Convert to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Upload to storage
    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `system/manuals/${Date.now()}-${safeFilename}`;
    const uploadResult = await uploadFile(key, buffer, 'application/pdf');

    logger.info({ msg: '[ManualUpload] Uploaded to storage', storageUri: uploadResult.storageUri });

    // 3. Deactivate previous manuals and create new record in a transaction
    const manual = await prisma.$transaction(async (tx) => {
      await tx.standardManual.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      return tx.standardManual.create({
        data: {
          filename: file.name,
          storagePath: uploadResult.storageUri,
          version: version.trim(),
          uploadedBy: 'system-admin',
          isActive: true,
        },
      });
    });

    logger.info({ msg: '[ManualUpload] DB record created', manualId: manual.id });

    // 4. Trigger background indexing — logged but non-blocking.
    //    In production this should be a BullMQ job. For the current architecture
    //    (persistent server process) a non-awaited promise is acceptable provided
    //    the process stays alive long enough to complete it.
    indexStandardManual(manual.id, buffer).catch((err: unknown) => {
      logger.error({
        msg: '[ManualUpload] Background indexing failed',
        manualId: manual.id,
        err,
      });
    });

    return NextResponse.json(
      {
        message:
          'Standard manual uploaded successfully. Background indexing has started — this may take a few minutes.',
        manual: {
          id: manual.id,
          filename: manual.filename,
          version: manual.version,
          isActive: manual.isActive,
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    logger.error({ msg: '[ManualUpload] Unhandled error', err: error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
