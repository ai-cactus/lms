import { NextRequest, NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { createUploadUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { MAX_VIDEO_BYTES, ALLOWED_VIDEO_TYPES } from '@/lib/video/upload-config';

// Mints a short-lived URL the browser uploads the video directly to (GCS V4
// signed resumable session). This keeps large files off the app server, which
// sits behind Cloudflare/Nginx body-size and timeout limits that 524-time out
// big multipart POSTs. The legacy `/upload` proxy route remains as a fallback
// for environments where GCS is unavailable.

interface UploadUrlRequest {
  filename: string;
  contentType: string;
  size: number;
}

/** Narrows the parsed JSON body to a well-formed request, or returns an error message. */
function parseBody(
  body: unknown,
): { ok: true; value: UploadUrlRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const { filename, contentType, size } = body as Record<string, unknown>;

  if (typeof filename !== 'string' || filename.trim().length === 0) {
    return { ok: false, error: 'filename is required' };
  }
  if (typeof contentType !== 'string' || contentType.length === 0) {
    return { ok: false, error: 'contentType is required' };
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'size must be a positive number' };
  }

  return { ok: true, value: { filename, contentType, size } };
}

export async function POST(req: NextRequest) {
  if (!(await verifySystemAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = parseBody(await req.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { filename, contentType, size } = parsed.value;

    if (!(ALLOWED_VIDEO_TYPES as readonly string[]).includes(contentType)) {
      return NextResponse.json({ error: 'Video must be MP4 or WebM' }, { status: 400 });
    }
    if (size > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        { error: `Video exceeds ${Math.round(MAX_VIDEO_BYTES / 1048576)} MB` },
        { status: 413 },
      );
    }

    // Strip anything outside the safe set to prevent path traversal / weird keys.
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `system/videos/${Date.now()}-${safe}`;

    const result = await createUploadUrl(key, contentType);

    // Never expose an internal MinIO URL to a production browser — it is
    // unreachable from outside the Docker network. Signal the client to fall
    // back to the legacy proxy upload route instead.
    if (result.kind === 'minio-put') {
      logger.warn({ msg: '[VideoUpload] GCS unavailable — signalling proxy fallback', key });
      return NextResponse.json({ error: 'GCS_UNAVAILABLE' }, { status: 503 });
    }

    logger.info({ msg: '[VideoUpload] upload URL minted', key });
    return NextResponse.json(
      { uploadUrl: result.uploadUrl, storageUri: result.storageUri, kind: result.kind },
      { status: 200 },
    );
  } catch (err) {
    logger.error({ msg: '[VideoUpload] upload-url error', err });
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
  }
}
