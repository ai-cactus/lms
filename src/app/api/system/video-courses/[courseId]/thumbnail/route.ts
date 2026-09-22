import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import prisma from '@/lib/prisma';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { deleteFile, uploadFile } from '@/lib/storage';
import { logger } from '@/lib/logger';
import {
  ALLOWED_THUMBNAIL_TYPES,
  MAX_THUMBNAIL_UPLOAD_BYTES,
  THUMBNAIL_MAX_WIDTH,
} from '@/lib/video/upload-config';
import { streamPoster } from '@/lib/video/poster-response';
import {
  CUSTOM_THUMBNAIL_KEY_PREFIX,
  resolveCourseThumbnailStorageUri,
} from '@/lib/video/thumbnail';
import {
  deleteReplacedCustomThumbnail,
  findManagedVideoCourse,
  refreshCourseThumbnailSurfaces,
  writeCourseThumbnail,
} from '@/lib/video/custom-thumbnail';

export const dynamic = 'force-dynamic';

const JPEG_QUALITY = 82;

/**
 * Decodes the upload and re-encodes it as a JPEG no wider than the posters.
 * Re-encoding is the validation: a file whose declared type lies, or whose
 * bytes are not an image, fails to decode here. sharp drops EXIF/ICC metadata
 * unless told to keep it, so a phone photo's location never reaches storage;
 * `autoOrient()` applies the EXIF orientation before that metadata is discarded.
 */
async function normalizeThumbnail(input: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
      .autoOrient()
      .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * The back-office preview of a system video course's current thumbnail, for the
 * /system edit page. That page has no portal session, so it cannot use
 * /api/courses/[id]/thumbnail; this route sits under the proxy's self-
 * authenticated /api/system/ prefix and is gated by the system-admin cookie.
 *
 * Any status is served — the admin previews drafts and retired courses too. The
 * read matches the edit page's own, so an archived course 404s here as it does
 * there. Served `no-store` and read uncached so the admin sees their latest
 * write immediately.
 */
export async function GET(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  if (!(await verifySystemAdminCookie())) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { courseId } = await params;

  const course = await prisma.course.findFirst({
    where: { id: courseId, type: 'video', isGlobal: true },
    select: {
      type: true,
      thumbnailStorageUri: true,
      previewPosterStorageUri: true,
      lessons: {
        orderBy: { order: 'asc' },
        take: 1,
        select: { videoPosterStorageUri: true },
      },
    },
  });
  if (!course) return new Response('Not found', { status: 404 });

  const storageUri = resolveCourseThumbnailStorageUri({
    type: course.type,
    thumbnailStorageUri: course.thumbnailStorageUri,
    previewPosterStorageUri: course.previewPosterStorageUri,
    firstLessonPosterStorageUri: course.lessons[0]?.videoPosterStorageUri,
  });
  if (!storageUri) return new Response('No thumbnail for this course', { status: 404 });

  return streamPoster(request, storageUri, { courseId }, { cache: 'no-store' });
}

/**
 * Sets a system video course's custom thumbnail from an uploaded image
 * (multipart field `image`). Returns `{ thumbnailSource: 'custom' }` on success.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  if (!(await verifySystemAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { courseId } = await params;

  const course = await findManagedVideoCourse(courseId);
  if (!course) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get('image');
  } catch (err) {
    logger.warn({ msg: '[video-thumbnail] Unreadable upload body', err, courseId });
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing image file' }, { status: 400 });
  }
  if (!(ALLOWED_THUMBNAIL_TYPES as readonly string[]).includes(file.type)) {
    logger.warn({ msg: '[video-thumbnail] Rejected type', courseId, type: file.type });
    return NextResponse.json({ error: 'Image must be JPEG, PNG or WebP' }, { status: 400 });
  }
  if (file.size > MAX_THUMBNAIL_UPLOAD_BYTES) {
    logger.warn({ msg: '[video-thumbnail] Rejected size', courseId, size: file.size });
    return NextResponse.json(
      { error: `Image exceeds ${Math.round(MAX_THUMBNAIL_UPLOAD_BYTES / 1048576)} MB` },
      { status: 413 },
    );
  }

  const jpeg = await normalizeThumbnail(Buffer.from(await file.arrayBuffer()));
  if (!jpeg) {
    logger.warn({ msg: '[video-thumbnail] Rejected undecodable image', courseId });
    return NextResponse.json({ error: 'The file is not a readable image' }, { status: 400 });
  }

  const key = `${CUSTOM_THUMBNAIL_KEY_PREFIX}${courseId}/${Date.now()}-${randomUUID()}.jpg`;
  let storageUri: string;
  try {
    ({ storageUri } = await uploadFile(key, jpeg, 'image/jpeg'));
  } catch (err) {
    logger.error({ msg: '[video-thumbnail] Storage upload failed', err, courseId });
    return NextResponse.json({ error: 'Failed to store the image' }, { status: 502 });
  }

  try {
    await writeCourseThumbnail(courseId, storageUri);
  } catch (err) {
    logger.error({ msg: '[video-thumbnail] Failed to save thumbnail', err, courseId });
    // Nothing references the object we just wrote.
    deleteFile(storageUri).catch((cleanupErr) => {
      logger.error({
        msg: '[video-thumbnail] Failed to delete unsaved thumbnail',
        err: cleanupErr,
        courseId,
      });
    });
    return NextResponse.json({ error: 'Failed to save the thumbnail' }, { status: 500 });
  }

  refreshCourseThumbnailSurfaces(courseId);
  if (course.thumbnailStorageUri !== storageUri) {
    await deleteReplacedCustomThumbnail(course.thumbnailStorageUri, courseId);
  }

  logger.info({
    msg: '[video-thumbnail] Custom thumbnail uploaded',
    courseId,
    bytes: jpeg.length,
  });
  return NextResponse.json({ thumbnailSource: 'custom' }, { status: 201 });
}
