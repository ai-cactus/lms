import { NextRequest, NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { uploadFile } from '@/lib/storage';
import { logger } from '@/lib/logger';

const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_UPLOAD_BYTES ?? 500 * 1024 * 1024);
const ALLOWED = ['video/mp4', 'video/webm'];

// Uploads ONE video file (a lecture or the preview clip) and returns its
// storage URI. The client calls this once per video, then submits the course
// metadata as JSON to the main route — avoiding one oversized multipart POST.
export async function POST(req: NextRequest) {
  if (!(await verifySystemAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const file = form.get('video');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing video file' }, { status: 400 });
    }
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: 'Video must be MP4 or WebM' }, { status: 400 });
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        { error: `Video exceeds ${Math.round(MAX_VIDEO_BYTES / 1048576)} MB` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `system/videos/${Date.now()}-${safe}`;
    const { storageUri } = await uploadFile(key, buffer, file.type);

    return NextResponse.json({ storageUri }, { status: 201 });
  } catch (err) {
    logger.error({ msg: '[VideoUpload/single] error', err });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
