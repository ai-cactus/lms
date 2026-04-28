import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { PrismaClient } from '@prisma/client';
import { uploadFile } from '@/lib/storage';
import { indexStandardManual } from '@/lib/manual-indexer';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const version = formData.get('version') as string;

    if (!file || !version) {
      return NextResponse.json({ error: 'Missing file or version parameter' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
    }

    // 1. Convert to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Upload to storage
    const key = `system/manuals/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const uploadResult = await uploadFile(key, buffer, file.type);

    // 3. Deactivate previous manuals
    await prisma.standardManual.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    // 4. Create database record
    const manual = await prisma.standardManual.create({
      data: {
        filename: file.name,
        storagePath: uploadResult.storageUri,
        version,
        uploadedBy: session.user.id,
        isActive: true,
      },
    });

    // 5. Trigger indexing asynchronously (don't block the response)
    // In a robust system, this would be a BullMQ job. For now, a non-awaited promise works
    // if the server process stays alive.
    indexStandardManual(manual.id, buffer).catch((err) => {
      console.error(`[API] Background indexing failed for manual ${manual.id}:`, err);
    });

    return NextResponse.json({
      message: 'Standard manual uploaded successfully. Indexing started.',
      manual: {
        id: manual.id,
        filename: manual.filename,
        version: manual.version,
      },
    });
  } catch (error: unknown) {
    console.error('[API] Upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
