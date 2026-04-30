import { NextRequest, NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/storage';
import { manualIndexerQueue } from '@/lib/queue/manual-indexer-queue';
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

    // 1. Convert to buffer and upload to storage
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `system/manuals/${Date.now()}-${safeFilename}`;
    const uploadResult = await uploadFile(key, buffer, 'application/pdf');

    logger.info({ msg: '[ManualUpload] Uploaded to storage', storageUri: uploadResult.storageUri });

    // 2. Deactivate previous manuals and create new record — in a transaction
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
          // processedAt stays null until the indexer worker completes
        },
      });
    });

    logger.info({ msg: '[ManualUpload] DB record created', manualId: manual.id });

    // 3. Enqueue the indexing job via BullMQ.
    //    The worker downloads the file from storage and runs the full pipeline.
    //    This returns immediately — the Next.js server process is never blocked.
    const job = await manualIndexerQueue.add(
      'index-manual',
      {
        manualId: manual.id,
        storagePath: uploadResult.storageUri,
      },
      {
        // Use the manualId as the job ID so duplicate uploads are safe to detect
        jobId: `manual-${manual.id}`,
      },
    );

    logger.info({
      msg: '[ManualUpload] Indexing job enqueued',
      manualId: manual.id,
      bullJobId: job.id,
    });

    return NextResponse.json(
      {
        message:
          'Standard manual uploaded successfully. Indexing job has been queued — this may take a few minutes.',
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
